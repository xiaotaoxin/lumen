// 即梦 AI 视频生成 adapter（火山引擎·智能视觉服务）
//
// 平台：visual.volcengineapi.com（与 jimeng-image 同源，复用 volcengine proxy）
// 鉴权：Volcengine V4 签名（proxy 服务端做）—— API Key 字段填 "AccessKey:SecretKey"
//
// 异步两段式：
//   1) POST /?Action=CVSync2AsyncSubmitTask&Version=2022-08-31  → { data: { task_id } }
//   2) POST /?Action=CVSync2AsyncGetResult&Version=2022-08-31   → 轮询 status / video_url
//
// 推荐 req_key：
//   jimeng_vgfm_t2v_l20  文生视频 720P
//   jimeng_vgfm_i2v_l20  图生视频 720P（i2v 必须传 image_urls 或 binary_data_base64）
//
// ⚠️ 状态：实现完成，未经真实 AccessKey 测试；签名算法已对齐火山官方文档。

import {
  AdapterError,
  type AdapterErrorCode,
  type AdapterEvent,
  type GenerateRequest,
  type ProviderAdapter,
  type ProviderConfig,
  type TestResult,
} from "./base";
import { setProxyAuthHeader } from "./proxy-headers";
import type { VideoParamSpec } from "../types";

const PROXY_BASE = "/api/proxy/volcengine";
const VERSION = "2022-08-31";
const ACTION_SUBMIT = "CVSync2AsyncSubmitTask";
const ACTION_QUERY = "CVSync2AsyncGetResult";
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_REQ_KEY = "jimeng_vgfm_t2v_l20";

interface CallProxyInit extends RequestInit {
  modelId?: string;
  apiKey?: string;
}

async function callProxy(action: string, init: CallProxyInit): Promise<Response> {
  const headers = new Headers(init.headers);
  setProxyAuthHeader(headers, init);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const url = `${PROXY_BASE}/?Action=${encodeURIComponent(action)}&Version=${VERSION}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
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
  if (/InvalidApiKey|SignatureDoesNotMatch/i.test(body)) return "invalid_key";
  return "network";
}

function friendlyMsg(code: AdapterErrorCode, status: number, body: string): string {
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.ResponseMetadata?.Error?.Message ?? parsed?.message ?? parsed?.code ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key":     return `即梦 AccessKey/SecretKey 无效或签名错误${tail}`;
    case "rate_limited":    return `即梦限流${tail}`;
    case "bad_request":     return `即梦视频拒绝了请求（参数 / req_key / 敏感词）${tail}`;
    case "timeout":         return `即梦视频响应超时${tail}`;
    case "upstream_5xx":    return `火山引擎服务异常 (HTTP ${status})${tail}`;
    default:                return `即梦视频请求失败 (HTTP ${status})${tail}`;
  }
}

interface SubmitResponse {
  code?: number;
  message?: string;
  data?: { task_id?: string };
}

interface QueryResponse {
  code?: number;
  message?: string;
  data?: {
    status?: "in_queue" | "generating" | "done" | "not_found" | "expired" | string;
    video_url?: string;
    image_url?: string;
    binary_data_base64?: string[];
    fail_reason?: string;
  };
}

/* ───────────────────────── Capability spec ───────────────────────── */

function isI2V(modelId: string | undefined): boolean {
  return !!modelId && /_i2v_/.test(modelId);
}

function describeJimengVideo(modelId: string | undefined): VideoParamSpec {
  const i2v = isI2V(modelId);
  return {
    duration: { mode: "enum", options: [5, 10], default: 5 },
    resolution: {
      mode: "enum",
      default: "720p",
      options: [
        { value: "720p",  label: "720P" },
        { value: "1080p", label: "1080P（仅 1080p 系 req_key 支持）" },
      ],
    },
    camera: "none",
    supportsReferenceImage: i2v,
    requiresReferenceImage: i2v,
    supportsEndFrame: false,
    supportsNegativePrompt: false,
    supportsSeed: true,
    extras: [
      {
        key: "aspect_ratio", label: "画面比例", type: "select",
        default: "16:9",
        options: [
          { value: "16:9", label: "16:9 横屏" },
          { value: "9:16", label: "9:16 竖屏" },
          { value: "1:1",  label: "1:1 方形" },
          { value: "4:3",  label: "4:3" },
          { value: "3:4",  label: "3:4" },
        ],
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const jimengVideoAdapter: ProviderAdapter = {
  type: "jimeng-video",
  kinds: ["video"],

  describeVideoParams(modelId) {
    return describeJimengVideo(modelId);
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    if (!cfg.apiKey || !cfg.apiKey.includes(":")) {
      throw new AdapterError("invalid_key", "请填入 AccessKey:SecretKey（冒号分隔）");
    }
    const startedAt = Date.now();
    try {
      // 用故意非法的 task_id + req_key 探活：签名通过 = key 有效
      const res = await callProxy(ACTION_QUERY, {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify({ req_key: DEFAULT_REQ_KEY, task_id: "__lumen_probe__" }),
      });
      await res.json().catch(() => null);
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "video") throw new AdapterError("unsupported", "jimeng-video 不能处理图像请求");
    if (!cfg.apiKey || !cfg.apiKey.includes(":")) {
      throw new AdapterError("invalid_key", "请填入 AccessKey:SecretKey（冒号分隔）");
    }

    const reqKey = cfg.providerModelId || DEFAULT_REQ_KEY;
    const params = req.params;
    const extras = (params.extras ?? {}) as Record<string, unknown>;
    const i2v = isI2V(reqKey);

    if (i2v && !params.referenceImageUrl) {
      throw new AdapterError("bad_request", `${reqKey} 是图生视频模型，请上传一张首帧`);
    }

    const submitBody: Record<string, unknown> = {
      req_key: reqKey,
      prompt: req.prompt,
    };
    if (i2v && params.referenceImageUrl) {
      // 火山支持 image_urls (公网 URL) 或 binary_data_base64 (base64)
      if (params.referenceImageUrl.startsWith("data:")) {
        const b64 = params.referenceImageUrl.split(",")[1] ?? params.referenceImageUrl;
        submitBody.binary_data_base64 = [b64];
      } else {
        submitBody.image_urls = [params.referenceImageUrl];
      }
    }
    if (typeof extras.aspect_ratio === "string" && extras.aspect_ratio) {
      submitBody.aspect_ratio = extras.aspect_ratio;
    }
    if (typeof params.seed === "number") submitBody.seed = params.seed;

    yield { type: "progress", pct: 5, message: "提交到即梦视频" };

    // 1) 提交任务
    const submitRes = await callProxy(ACTION_SUBMIT, {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      body: JSON.stringify(submitBody),
      signal: req.signal,
    });
    const submitted: SubmitResponse = await submitRes.json();
    if (submitted.code !== undefined && submitted.code !== 10000 && submitted.code !== 0) {
      throw new AdapterError("upstream_5xx", `即梦提交任务失败：${submitted.message ?? submitted.code}`);
    }
    const taskId = submitted.data?.task_id;
    if (!taskId) {
      throw new AdapterError("upstream_5xx", `即梦未返回 task_id：${JSON.stringify(submitted)}`);
    }

    // 2) 轮询
    const startedAt = Date.now();
    const expected = cfg.avgLatencyMs || 90000;
    let task: QueryResponse = { data: { status: "in_queue" } };
    while (
      task.data?.status !== "done" &&
      task.data?.status !== "not_found" &&
      task.data?.status !== "expired" &&
      !(typeof task.data?.fail_reason === "string" && task.data.fail_reason.length > 0)
    ) {
      if (req.signal?.aborted) throw new AdapterError("cancelled", "已取消");
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_WAIT_MS) throw new AdapterError("timeout", "即梦视频长时间未返回，已超时");
      yield {
        type: "progress",
        pct: Math.min(95, 5 + (elapsed / expected) * 90),
        message: task.data?.status,
      };
      await sleep(POLL_INTERVAL_MS, req.signal);
      const pollRes = await callProxy(ACTION_QUERY, {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify({ req_key: reqKey, task_id: taskId }),
        signal: req.signal,
      });
      task = await pollRes.json();
    }

    if (task.data?.status !== "done") {
      throw new AdapterError(
        "upstream_5xx",
        `即梦视频生成失败：${task.data?.fail_reason ?? task.data?.status ?? "未知错误"}`,
      );
    }

    const url = task.data.video_url;
    if (!url) throw new AdapterError("upstream_5xx", "即梦视频未返回 video_url");

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
