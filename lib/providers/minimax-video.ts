// MiniMax 海螺视频 adapter
//
// 平台：https://api.minimax.io/v1/* （独立平台，不走百炼）
// 鉴权：Authorization: Bearer <API_KEY>（proxy 自动改写 X-Lumen-API-Key）
//
// 推荐 model（按优先级）：
//   MiniMax-Hailuo-2.3      文生视频，最新旗舰，720P/1080P，6/10 秒
//   MiniMax-Hailuo-2.3-Fast 图生视频（i2v）快速版
//   MiniMax-Hailuo-02       上一代
//   T2V-01-Director         运镜指令优化版（如 [Truck left] / [Pan left] / [Push in]）
//   T2V-01                  通用 T2V
//
// 三段式异步流：
//   1) POST /v1/video_generation  { model, prompt, ... }      → { task_id }
//   2) GET  /v1/query/video_generation?task_id=xxx            → { status, file_id }
//      status: Preparing | Queueing | Processing | Success | Fail
//   3) GET  /v1/files/retrieve?file_id=xxx                    → { download_url }
//
// 注意：download_url 有效期 9 小时；任务完整跑完一般 1-3 分钟。

import {
  AdapterError,
  assertHasAuth,
  type AdapterErrorCode,
  type AdapterEvent,
  type GenerateRequest,
  type ProviderAdapter,
  type ProviderConfig,
  type TestResult,
} from "./base";
import { setProxyAuthHeader } from "./proxy-headers";
import type { VideoParamSpec } from "../types";

const PROXY_BASE = "/api/proxy/minimax";
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = "MiniMax-Hailuo-2.3";

/* ───────────────────────── HTTP helpers ───────────────────────── */

interface CallProxyInit extends RequestInit {
  modelId?: string;
  apiKey?: string;
}

async function callProxy(path: string, init: CallProxyInit): Promise<Response> {
  const headers = new Headers(init.headers);
  setProxyAuthHeader(headers, init);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}${path}`, { ...init, headers });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "AbortError" || init.signal?.aborted) {
      throw new AdapterError("cancelled", "已取消");
    }
    throw new AdapterError("network", `连接代理失败：${(err as Error)?.message ?? err}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code = mapStatus(res.status, text);
    throw new AdapterError(code, friendlyMsg(code, res.status, text), { status: res.status, details: text });
  }
  return res;
}

function mapStatus(status: number, body: string): AdapterErrorCode {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429 || /1002/.test(body)) return "rate_limited";
  if (status === 400 || status === 422 || /2013/.test(body)) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream_5xx";
  if (/1004|InvalidApiKey/i.test(body)) return "invalid_key";
  if (/1008/.test(body)) return "quota_exceeded";
  return "network";
}

function friendlyMsg(code: AdapterErrorCode, status: number, body: string): string {
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.base_resp?.status_msg ?? parsed?.message ?? parsed?.code ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key":     return `MiniMax API Key 无效或未授权${tail}`;
    case "rate_limited":    return `MiniMax 限流${tail}`;
    case "bad_request":     return `MiniMax 拒绝了请求（参数或敏感词）${tail}`;
    case "timeout":         return `MiniMax 响应超时${tail}`;
    case "upstream_5xx":    return `MiniMax 服务异常 (HTTP ${status})${tail}`;
    case "quota_exceeded":  return `MiniMax 余额不足${tail}`;
    default:                return `MiniMax 请求失败 (HTTP ${status})${tail}`;
  }
}

/* ───────────────────────── Response shapes ───────────────────────── */

interface BaseResp {
  status_code?: number;
  status_msg?: string;
}

interface CreateTaskResponse {
  task_id?: string;
  base_resp?: BaseResp;
}

interface QueryTaskResponse {
  task_id?: string;
  status?: "Preparing" | "Queueing" | "Processing" | "Success" | "Fail";
  file_id?: string;
  video_width?: number;
  video_height?: number;
  base_resp?: BaseResp;
}

interface FileRetrieveResponse {
  file?: {
    file_id?: string;
    download_url?: string;
    filename?: string;
    bytes?: number;
  };
  base_resp?: BaseResp;
}

/* ───────────────────────── Capability spec ───────────────────────── */

function isI2V(modelId: string | undefined): boolean {
  return !!modelId && /Fast$/i.test(modelId);
}

function describeVideo(modelId: string | undefined): VideoParamSpec {
  const i2v = isI2V(modelId);
  return {
    duration: { mode: "enum", options: [6, 10], default: 6 },
    resolution: {
      mode: "enum",
      default: "768P",
      options: [
        { value: "720P",  label: "720P" },
        { value: "768P",  label: "768P (默认)" },
        { value: "1080P", label: "1080P" },
      ],
    },
    camera: "none",
    supportsReferenceImage: i2v,
    requiresReferenceImage: i2v,
    supportsEndFrame: false,
    supportsNegativePrompt: false,
    supportsSeed: false,
    extras: [
      {
        key: "prompt_optimizer", label: "提示词自动优化", type: "boolean",
        default: true,
      },
      {
        key: "fast_pretreatment", label: "加速优化", type: "boolean",
        default: false,
        hint: "仅 Hailuo-2.3 / 02 系列支持",
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const minimaxVideoAdapter: ProviderAdapter = {
  type: "minimax-video",
  kinds: ["video"],

  describeVideoParams(modelId) {
    return describeVideo(modelId);
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请先填入 MiniMax API Key");
    const startedAt = Date.now();
    // 用一个不存在的 task_id 反查鉴权：401/403 = key 无效；其它 4xx = key OK
    try {
      await callProxy("/v1/query/video_generation?task_id=__lumen_probe__", {
        method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey,
      });
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "video") throw new AdapterError("unsupported", "minimax-video 不能处理图像请求");
    assertHasAuth(cfg, "请先填入 MiniMax API Key");

    const model = cfg.providerModelId || DEFAULT_MODEL;
    const params = req.params;
    const extras = (params.extras ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
    };
    if (params.duration && (params.duration === 6 || params.duration === 10)) {
      body.duration = params.duration;
    }
    if (params.resolution) {
      body.resolution = params.resolution.toUpperCase();
    }
    if (typeof extras.prompt_optimizer === "boolean") body.prompt_optimizer = extras.prompt_optimizer;
    if (typeof extras.fast_pretreatment === "boolean") body.fast_pretreatment = extras.fast_pretreatment;

    yield { type: "progress", pct: 5, message: "提交到 MiniMax" };

    // 1) 创建任务
    const createRes = await callProxy("/v1/video_generation", {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const created: CreateTaskResponse = await createRes.json();
    if (created.base_resp?.status_code && created.base_resp.status_code !== 0) {
      throw new AdapterError(
        mapStatus(200, JSON.stringify(created.base_resp)),
        `MiniMax 创建任务失败：${created.base_resp.status_msg ?? created.base_resp.status_code}`,
      );
    }
    const taskId = created.task_id;
    if (!taskId) {
      throw new AdapterError("upstream_5xx", `MiniMax 未返回 task_id：${JSON.stringify(created)}`);
    }

    // 2) 轮询状态
    const startedAt = Date.now();
    const expected = cfg.avgLatencyMs || 60000;
    let task: QueryTaskResponse = { status: "Preparing" };

    while (
      task.status !== "Success" &&
      task.status !== "Fail"
    ) {
      if (req.signal?.aborted) throw new AdapterError("cancelled", "已取消");
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_WAIT_MS) throw new AdapterError("timeout", "MiniMax 视频长时间未返回，已超时");
      yield { type: "progress", pct: Math.min(95, 5 + (elapsed / expected) * 90), message: task.status };
      await sleep(POLL_INTERVAL_MS, req.signal);
      const pollRes = await callProxy(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
        method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
      });
      task = await pollRes.json();
    }

    if (task.status !== "Success") {
      throw new AdapterError(
        "upstream_5xx",
        `MiniMax 视频生成失败：${task.base_resp?.status_msg ?? task.base_resp?.status_code ?? "未知错误"}`,
      );
    }

    const fileId = task.file_id;
    if (!fileId) throw new AdapterError("upstream_5xx", "MiniMax 未返回 file_id");

    // 3) 用 file_id 拿 download_url
    const fileRes = await callProxy(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
      method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
    });
    const file: FileRetrieveResponse = await fileRes.json();
    const url = file.file?.download_url;
    if (!url) throw new AdapterError("upstream_5xx", "MiniMax File API 未返回 download_url");

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "video",
      videoUrl: url,
      cost: cfg.costPerCall,
    };
  },
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AdapterError("cancelled", "已取消"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AdapterError("cancelled", "已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
