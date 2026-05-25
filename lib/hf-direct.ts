// 浏览器侧直连 HuggingFace Space 的 Gradio API。
//
// 为什么不走 Next.js 服务端 proxy 了？
//   - 国内 ISP 经常对 Node.js 出站的 hf.space 流量做拦截 / 严重丢包，
//     即便 Windows 系统代理通过 Clash/V2Ray，Node 默认也不读取那个代理。
//   - 浏览器 fetch 走 Windows 网络栈，自动遵循系统代理；很多用户浏览器
//     能直连 hf.space，Node 却 "fetch failed"。
//   - 把调用整体搬到浏览器侧，零配置就能复用用户已有的网络环境。
//
// CORS：Gradio Space 默认对 /gradio_api/* 开放 `Access-Control-Allow-Origin: *`，
// 直接从 localhost / 部署域名 fetch 都行。

const SPACE_URL = (space: string) =>
  `https://${space.replace(/\//g, "-").toLowerCase()}.hf.space`;

interface ParsedSse { event: string; data: string }

/**
 * 调一次 HF Space 的 Gradio API。
 * 1. POST /gradio_api/call/{endpoint}        → { event_id }
 * 2. GET  /gradio_api/call/{endpoint}/{id}   → SSE 流，最后 "complete" 带结果
 *
 * @param space     "user/space-name"
 * @param endpoint  "/infer" 等
 * @param data      Gradio 入参数组（顺序与 /info 一致）
 * @param timeoutMs 整体超时（含排队 + 推理）
 */
export async function callHfSpace<T>(
  space: string,
  endpoint: string,
  data: unknown[],
  timeoutMs: number = 120_000,
): Promise<T> {
  const base = SPACE_URL(space);
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  // 1) 提交任务
  let initResp: Response;
  try {
    initResp = await fetch(`${base}/gradio_api/call${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    throw new HfTransientError(`连接 ${base} 失败：${(e as Error).message}`);
  }
  if (!initResp.ok) {
    const t = await initResp.text().catch(() => "");
    throw new Error(`Space 拒绝任务 HTTP ${initResp.status}：${t.slice(0, 200)}`);
  }
  const initJson = (await initResp.json()) as { event_id?: string };
  if (!initJson.event_id) throw new Error("Space 未返回 event_id");

  // 2) 拉 SSE 流
  let streamResp: Response;
  try {
    streamResp = await fetch(`${base}/gradio_api/call${path}/${initJson.event_id}`);
  } catch (e) {
    throw new HfTransientError(`SSE 连接失败：${(e as Error).message}`);
  }
  if (!streamResp.ok || !streamResp.body) {
    throw new Error(`SSE 流 HTTP ${streamResp.status}`);
  }

  const reader = streamResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const startTs = Date.now();

  try {
    while (true) {
      if (Date.now() - startTs > timeoutMs) {
        throw new Error(`生成超时（${Math.floor(timeoutMs / 1000)}s）`);
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSse(chunk);
        if (!ev) continue;
        if (ev.event === "error") {
          // data: null 是 ZeroGPU 队列拒绝，是可重试的"瞬时"错误
          if (!ev.data || ev.data === "null") {
            throw new HfTransientError("ZeroGPU 队列拒绝（共享 GPU 繁忙）");
          }
          throw new Error(`Space 报错：${truncate(ev.data, 200)}`);
        }
        if (ev.event === "complete") {
          let arr: unknown;
          try { arr = JSON.parse(ev.data); }
          catch { throw new Error("解析 complete 数据失败"); }
          if (!Array.isArray(arr) || arr.length === 0) {
            throw new Error("complete 数据为空");
          }
          return normalizeResult(arr[0], base) as T;
        }
        // generating / heartbeat / log → 忽略
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* noop */ }
  }
  throw new Error("SSE 流意外关闭");
}

/** 带 backoff 的重试包装。仅对 HfTransientError 重试，其它错误立即抛。 */
export async function callHfSpaceWithRetry<T>(
  space: string,
  endpoint: string,
  data: unknown[],
  timeoutMs: number = 120_000,
  retries: number = 2,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = 1500 * 2 ** (attempt - 1);  // 1.5s → 3s → 6s
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      return await callHfSpace<T>(space, endpoint, data, timeoutMs);
    } catch (e) {
      lastErr = e as Error;
      if (!(e instanceof HfTransientError)) break;   // 永久错直接抛
    }
  }
  throw lastErr ?? new Error("HF Space 调用失败");
}

/** 2 秒内探活 HF Space —— 国内网络不通时立刻给具体提示，不让用户白等 5 分钟。 */
export async function checkHfReachable(): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    // 用 /config 探活，最轻量、无副作用
    const r = await fetch("https://multimodalart-flux-fill-outpaint.hf.space/config", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) {
      throw new Error(`HF Space 不可达（HTTP ${r.status}）。请检查浏览器网络 / 系统代理。`);
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error(
        "浏览器无法连到 hf.space（2s 超时）—— 国内网络多半被封。" +
        "请在系统层面装/开启代理（Clash / V2Ray 等），让浏览器流量能上 HuggingFace。",
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* ─── 工具 ─── */

export class HfTransientError extends Error {
  constructor(msg: string) { super(msg); this.name = "HfTransientError"; }
}

function parseSse(chunk: string): ParsedSse | null {
  let event = "message";
  let data = "";
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return data ? { event, data } : null;
}

function normalizeResult(v: unknown, base: string): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { url?: string; path?: string };
    if (o.url) return o;
    if (o.path) return { ...o, url: `${base}/gradio_api/file=${o.path}` };
  }
  return v;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "..." : s;
}
