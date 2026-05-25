// Replicate image adapter — covers Flux 1.1 Pro/Dev/Schnell, SDXL,
// Recraft, Ideogram, Stable Cascade and hundreds of other models hosted
// on replicate.com. One adapter, many models.
//
// Model id format the user enters in admin/models:
//   - "owner/name"           → /v1/models/owner/name/predictions  (official models)
//   - "owner/name:<version>" → /v1/predictions  with body { version }
//   - "<64-hex>"             → /v1/predictions  with body { version }
//
// Replicate uses async predictions. We POST with `Prefer: wait=30` so
// short jobs return synchronously; longer ones we poll until terminal.

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
import type { ImageParamSpec } from "../types";

const PROXY_BASE = "/api/proxy/replicate";
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 5 * 60 * 1000;

function aspectRatio(size: string | undefined): string {
  if (!size || size === "auto") return "1:1";
  const [w, h] = size.split("x");
  if (w === h) return "1:1";
  switch (size) {
    case "1024x1792": return "9:16";
    case "1024x1536": return "2:3";
    case "1024x1408": return "3:4";
    case "1408x1024": return "4:3";
    case "1536x1024": return "3:2";
    case "1792x1024": return "16:9";
    case "1792x768":  return "21:9";
    default: return "1:1";
  }
}

function predictionEndpoint(modelId: string): { path: string; bodyExtras: Record<string, string> } {
  // owner/name:version
  if (modelId.includes(":")) {
    const [, version] = modelId.split(":", 2);
    return { path: "/v1/predictions", bodyExtras: { version } };
  }
  // owner/name (official-model alias)
  if (modelId.includes("/")) {
    return { path: `/v1/models/${modelId}/predictions`, bodyExtras: {} };
  }
  // bare version hash
  return { path: "/v1/predictions", bodyExtras: { version: modelId } };
}

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
    const code = mapStatus(res.status);
    throw new AdapterError(code, friendlyMsg(code, res.status, text), { status: res.status, details: text });
  }
  return res;
}

function mapStatus(status: number): AdapterErrorCode {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream_5xx";
  return "network";
}

function friendlyMsg(code: AdapterErrorCode, status: number, body: string): string {
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.detail ?? parsed?.title ?? parsed?.error ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key":  return `Replicate Token 无效或没有权限${tail}`;
    case "rate_limited": return `Replicate 限流${tail}`;
    case "bad_request":  return `Replicate 拒绝了请求（模型 ID 或参数问题）${tail}`;
    case "timeout":      return `Replicate 响应超时${tail}`;
    case "upstream_5xx": return `Replicate 服务异常 (HTTP ${status})${tail}`;
    default:             return `Replicate 请求失败 (HTTP ${status})${tail}`;
  }
}

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
}

/**
 * Replicate hosts hundreds of models, each with a different input schema.
 * We branch on providerModelId for the popular ones and fall back to a
 * minimal "prompt + aspect_ratio + maybe negative" spec for the rest.
 *
 * Sizes for Replicate are usually expressed as aspect_ratio strings rather
 * than W×H, because most models do their own internal sizing. We use the
 * Lumen-canonical W×H literals as values (so state survives model swap)
 * and the adapter's existing aspectRatio() helper does the conversion.
 */
const ASPECT_OPTIONS: Array<{ value: string; label: string; ratio: string }> = [
  { value: "1024x1024", label: "正方", ratio: "1:1" },
  { value: "1792x1024", label: "横屏", ratio: "16:9" },
  { value: "1024x1792", label: "竖屏", ratio: "9:16" },
  { value: "1536x1024", label: "横向", ratio: "3:2" },
  { value: "1024x1536", label: "竖向", ratio: "2:3" },
  { value: "1408x1024", label: "横向", ratio: "4:3" },
  { value: "1024x1408", label: "竖向", ratio: "3:4" },
  { value: "1792x768",  label: "超宽", ratio: "21:9" },
];

function describeFlux11Pro(): ImageParamSpec {
  return {
    size: { mode: "enum", options: ASPECT_OPTIONS, default: "1024x1024" },
    maxBatch: 1,                       // Flux 1.1 Pro 单图，多张需多次调用
    supportsNegativePrompt: false,     // Flux 不支持 negative prompt
    supportsSeed: true,
    supportsReferenceImages: false,
    extras: [
      {
        key: "safety_tolerance", label: "安全等级", type: "number",
        min: 1, max: 5, step: 1, default: 2,
        hint: "1 最严格、5 最宽松；争议内容选 5",
      },
      {
        key: "prompt_upsampling", label: "提示词增强", type: "boolean",
        default: true,
        hint: "Flux 自带的 prompt 改写，开关",
      },
      {
        key: "output_format", label: "输出格式", type: "select",
        default: "webp",
        options: [
          { value: "webp", label: "WebP（推荐）" },
          { value: "png",  label: "PNG" },
          { value: "jpg",  label: "JPG" },
        ],
      },
      {
        key: "output_quality", label: "输出质量", type: "number",
        min: 1, max: 100, step: 1, default: 80,
        hint: "WebP / JPG 的压缩质量，PNG 忽略",
      },
    ],
  };
}

function describeFluxSchnell(): ImageParamSpec {
  return {
    size: { mode: "enum", options: ASPECT_OPTIONS, default: "1024x1024" },
    maxBatch: 4,                       // schnell 支持 num_outputs
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsReferenceImages: false,
    extras: [
      {
        key: "output_format", label: "输出格式", type: "select",
        default: "webp",
        options: [
          { value: "webp", label: "WebP" },
          { value: "png",  label: "PNG" },
          { value: "jpg",  label: "JPG" },
        ],
      },
    ],
  };
}

function describeSDXL(): ImageParamSpec {
  return {
    size: { mode: "enum", options: ASPECT_OPTIONS, default: "1024x1024" },
    maxBatch: 4,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsReferenceImages: false,
    extras: [
      {
        key: "guidance_scale", label: "引导强度 (CFG)", type: "number",
        min: 1, max: 20, step: 0.5, default: 7.5,
        hint: "越高越贴 prompt，过高易僵硬；7-9 最常用",
      },
      {
        key: "num_inference_steps", label: "采样步数", type: "number",
        min: 10, max: 100, step: 5, default: 30,
        hint: "越多越精细但越慢，30-50 性价比最高",
      },
    ],
  };
}

function describeRecraftV3(): ImageParamSpec {
  return {
    size: { mode: "enum", options: ASPECT_OPTIONS, default: "1024x1024" },
    maxBatch: 1,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsReferenceImages: false,
    extras: [
      {
        key: "style", label: "Recraft 风格", type: "select",
        default: "any",
        options: [
          { value: "any",                  label: "自动" },
          { value: "realistic_image",      label: "写实摄影" },
          { value: "digital_illustration", label: "数字插画" },
          { value: "vector_illustration",  label: "矢量插画" },
        ],
      },
    ],
  };
}

function describeReplicateDefault(): ImageParamSpec {
  // 未知模型的最小 spec — Replicate 大多数模型都接 prompt + aspect_ratio。
  // 不暴露 extras（不知道字段名），把 batch 限到 1 防止意外多次调用。
  return {
    size: { mode: "enum", options: ASPECT_OPTIONS, default: "1024x1024" },
    maxBatch: 1,
    supportsNegativePrompt: true,      // 多数模型都支持，无害透传
    supportsSeed: true,
    supportsReferenceImages: false,
  };
}

export const replicateImageAdapter: ProviderAdapter = {
  type: "replicate-image",
  kinds: ["image"],

  describeImageParams(modelId) {
    if (!modelId) return describeReplicateDefault();
    // 基于 owner/name 前缀分支；版本 hash 部分忽略
    const base = modelId.split(":")[0].toLowerCase();
    if (base.includes("flux-1.1-pro") || base.includes("flux-pro")) return describeFlux11Pro();
    if (base.includes("flux-schnell") || base.includes("flux-dev")) return describeFluxSchnell();
    if (base.includes("sdxl") || base.includes("stable-diffusion")) return describeSDXL();
    if (base.includes("recraft")) return describeRecraftV3();
    return describeReplicateDefault();
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请先填入 Replicate API Token");
    const startedAt = Date.now();
    const res = await callProxy("/v1/account", { method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey });
    const json = await res.json().catch(() => ({}));
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: json?.username ? `账号：${json.username}（${json.type ?? "user"}）` : "OK",
    };
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") throw new AdapterError("unsupported", "replicate-image 不能处理视频请求");
    assertHasAuth(cfg, "请先填入 Replicate API Token");
    if (!cfg.providerModelId) {
      throw new AdapterError("bad_request", "请填写 Replicate 模型 ID（owner/name 或 owner/name:version）");
    }

    const params = req.params;
    const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);
    const { path, bodyExtras } = predictionEndpoint(cfg.providerModelId);

    // Replicate model schemas vary — we send a sensible common subset.
    // Models that don't recognize a field will silently ignore it; models
    // that error out on it surface as 422 with detail in the message.
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: aspectRatio(params.size),
      num_outputs: batch,
      // Adapter-declared extras (Flux safety_tolerance / SDXL guidance_scale / …).
      // Each branch in describeImageParams() picks the right keys for its model
      // family; unknown keys are silently ignored by Replicate.
      ...(params.extras ?? {}),
    };
    if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
    if (typeof params.seed === "number") input.seed = params.seed;

    yield { type: "progress", pct: 5, message: "提交到 Replicate" };

    // Prefer: wait=30 — Replicate may return the final result inline if the
    // model finishes within 30s, saving us a round trip.
    const createRes = await callProxy(path, {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      headers: { Prefer: "wait=30" },
      body: JSON.stringify({ ...bodyExtras, input }),
      signal: req.signal,
    });
    let prediction: Prediction = await createRes.json();
    if (!prediction?.id) throw new AdapterError("upstream_5xx", "Replicate 未返回 prediction id");

    const startedAt = Date.now();
    const expected = cfg.avgLatencyMs || 12000;

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (req.signal?.aborted) {
        // Best-effort cancel upstream so we don't burn credits on an
        // abandoned run — fire-and-forget.
        void callProxy(`/v1/predictions/${prediction.id}/cancel`, {
          method: "POST", modelId: cfg.modelId, apiKey: cfg.apiKey,
        }).catch(() => {});
        throw new AdapterError("cancelled", "已取消");
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_WAIT_MS) {
        throw new AdapterError("timeout", "Replicate 长时间未返回，已超时");
      }
      yield { type: "progress", pct: Math.min(95, 5 + (elapsed / expected) * 90) };
      await sleep(POLL_INTERVAL_MS, req.signal);
      const pollRes = await callProxy(`/v1/predictions/${prediction.id}`, {
        method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
      });
      prediction = await pollRes.json();
    }

    if (prediction.status !== "succeeded") {
      throw new AdapterError(
        prediction.status === "canceled" ? "cancelled" : "upstream_5xx",
        `Replicate 生成失败：${prediction.error ?? prediction.status}`,
      );
    }

    const out = prediction.output;
    const urls: string[] = Array.isArray(out)
      ? out.filter((x): x is string => typeof x === "string")
      : typeof out === "string" ? [out] : [];
    if (urls.length === 0) throw new AdapterError("upstream_5xx", "Replicate 未返回任何图像");

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "image",
      imageUrls: urls,
      cost: cfg.costPerCall * batch,
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
