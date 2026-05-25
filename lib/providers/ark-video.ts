// 火山方舟 Ark · Seedance 视频 adapter
//
// 平台：ark.cn-beijing.volces.com/api/v3
// 鉴权：Bearer ARK_API_KEY
//
// 异步两段式：
//   1) POST /api/v3/contents/generations/tasks
//      Body: { model, content: [{ type: "text", text }, { type: "image_url", image_url: { url }, role? }] }
//      → { id }
//   2) GET  /api/v3/contents/generations/tasks/{id}  → { status, content: { video_url } }
//
// 推荐 model（按优先级，2026-05）：
//   doubao-seedance-2-0-260128       ⭐ 旗舰，2K，4 模态输入（文/图/视频/音）+ 唇同步
//   doubao-seedance-2-0-fast-260128  快速版
//   doubao-seedance-1-0-pro-250528   上代

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

const PROXY_BASE = "/api/proxy/ark";
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = "doubao-seedance-2-0-260128";

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
    if ((err as Error).name === "AbortError" || init.signal?.aborted) {
      throw new AdapterError("cancelled", "已取消");
    }
    throw new AdapterError("network", `连接代理失败：${(err as Error).message}`);
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
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream_5xx";
  if (/InvalidApiKey|AuthenticationError/i.test(body)) return "invalid_key";
  return "network";
}

function friendlyMsg(code: AdapterErrorCode, status: number, body: string): string {
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.error?.message ?? parsed?.message ?? parsed?.code ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key":     return `火山方舟 API Key 无效${tail}`;
    case "rate_limited":    return `火山方舟限流${tail}`;
    case "bad_request":     return `火山方舟拒绝了请求（参数 / 模型 / 敏感词）${tail}`;
    case "timeout":         return `火山方舟响应超时${tail}`;
    case "upstream_5xx":    return `火山方舟服务异常 (HTTP ${status})${tail}`;
    default:                return `火山方舟请求失败 (HTTP ${status})${tail}`;
  }
}

interface CreateTaskResponse {
  id?: string;
  error?: { message?: string };
}

interface QueryTaskResponse {
  id?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | string;
  content?: { video_url?: string };
  error?: { message?: string };
}

/* ───────────────────────── Capability spec ───────────────────────── */

function describeArkVideo(modelId: string | undefined): VideoParamSpec {
  // Seedance 2.0 支持文生 + 图生（首帧 / 首尾帧）+ 多模态参考
  const isFast = !!modelId && /-fast/.test(modelId);
  return {
    duration: { mode: "range", min: 4, max: 15, step: 1, default: 5 },
    resolution: {
      mode: "enum",
      default: "1080p",
      options: [
        { value: "720p",  label: "720P" },
        { value: "1080p", label: "1080P" },
        { value: "2k",    label: isFast ? "2K（fast 不一定支持，建议 1080P）" : "2K" },
      ],
    },
    camera: "none",
    supportsReferenceImage: true,
    requiresReferenceImage: false,
    supportsEndFrame: true,
    supportsNegativePrompt: false,
    supportsSeed: true,
    extras: [
      {
        key: "ratio", label: "画面比例", type: "select",
        default: "16:9",
        options: [
          { value: "16:9", label: "16:9 横屏" },
          { value: "9:16", label: "9:16 竖屏" },
          { value: "1:1",  label: "1:1 方形" },
          { value: "4:3",  label: "4:3" },
          { value: "3:4",  label: "3:4" },
        ],
      },
      {
        key: "watermark", label: "AI 生成水印", type: "boolean",
        default: false,
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const arkVideoAdapter: ProviderAdapter = {
  type: "ark-video",
  kinds: ["video"],

  describeVideoParams(modelId) {
    return describeArkVideo(modelId);
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请填入火山方舟 API Key");
    const startedAt = Date.now();
    try {
      // 查询不存在的任务：401/403 = key 无效；404 = key OK
      await callProxy("/api/v3/contents/generations/tasks/__lumen_probe__", {
        method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey,
      });
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "video") throw new AdapterError("unsupported", "ark-video 不能处理图像请求");
    assertHasAuth(cfg, "请填入火山方舟 API Key");

    const model = cfg.providerModelId || DEFAULT_MODEL;
    const params = req.params;
    const extras = (params.extras ?? {}) as Record<string, unknown>;

    // 构造 content 数组：text + 可选 image_url
    const content: Array<Record<string, unknown>> = [
      { type: "text", text: req.prompt },
    ];
    if (params.referenceImageUrl) {
      content.push({
        type: "image_url",
        image_url: { url: params.referenceImageUrl },
        role: "first_frame",
      });
    }
    if (params.endFrameUrl) {
      content.push({
        type: "image_url",
        image_url: { url: params.endFrameUrl },
        role: "last_frame",
      });
    }

    const body: Record<string, unknown> = {
      model,
      content,
    };
    // Ark 视频参数透传：duration / resolution / ratio / watermark / seed
    if (params.duration) body.duration = params.duration;
    if (params.resolution) body.resolution = params.resolution;
    if (typeof params.seed === "number") body.seed = params.seed;
    if (typeof extras.ratio === "string" && extras.ratio) body.ratio = extras.ratio;
    if (typeof extras.watermark === "boolean") body.watermark = extras.watermark;

    yield { type: "progress", pct: 5, message: "提交到火山方舟" };

    // 1) 提交任务
    const createRes = await callProxy("/api/v3/contents/generations/tasks", {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const created: CreateTaskResponse = await createRes.json();
    if (created.error?.message) {
      throw new AdapterError("upstream_5xx", `火山方舟创建任务失败：${created.error.message}`);
    }
    const taskId = created.id;
    if (!taskId) {
      throw new AdapterError("upstream_5xx", `火山方舟未返回 task id：${JSON.stringify(created)}`);
    }

    // 2) 轮询
    const startedAt = Date.now();
    const expected = cfg.avgLatencyMs || 90000;
    let task: QueryTaskResponse = { status: "queued" };
    while (
      task.status !== "succeeded" &&
      task.status !== "failed" &&
      task.status !== "cancelled"
    ) {
      if (req.signal?.aborted) throw new AdapterError("cancelled", "已取消");
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_WAIT_MS) throw new AdapterError("timeout", "火山方舟视频长时间未返回，已超时");
      yield {
        type: "progress",
        pct: Math.min(95, 5 + (elapsed / expected) * 90),
        message: task.status,
      };
      await sleep(POLL_INTERVAL_MS, req.signal);
      const pollRes = await callProxy(`/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
        method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
      });
      task = await pollRes.json();
    }

    if (task.status !== "succeeded") {
      throw new AdapterError(
        "upstream_5xx",
        `火山方舟视频生成失败：${task.error?.message ?? task.status}`,
      );
    }

    const url = task.content?.video_url;
    if (!url) throw new AdapterError("upstream_5xx", "火山方舟未返回 video_url");

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
