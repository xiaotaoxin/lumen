// OpenAI image adapter — talks to the Next.js proxy at /api/proxy/openai/*,
// never to api.openai.com directly. The proxy is what attaches the real
// Authorization header server-side; we forward the user-supplied key via
// X-Lumen-API-Key (stage 1, pre-DB) and the proxy strips it before upstream.
//
// Endpoints used:
//   GET  /api/proxy/openai/v1/models                — testCall
//   POST /api/proxy/openai/v1/images/generations    — generate

import {
  AdapterError,
  assertHasAuth,
  type AdapterEvent,
  type GenerateRequest,
  type ProviderAdapter,
  type ProviderConfig,
  type TestResult,
} from "./base";
import { setProxyAuthHeader } from "./proxy-headers";
import type { ImageParamSpec } from "../types";

const DEFAULT_MODEL = "dall-e-3";
const PROXY_BASE = "/api/proxy/openai";

/** dall-e-3 only accepts these three. Anything else gets snapped to the closest. */
type OpenAISize = "1024x1024" | "1024x1792" | "1792x1024";

function snapSize(size: string | undefined): OpenAISize {
  if (size === "auto" || !size) return "1024x1024";
  // Portrait family
  if (size === "1024x1792" || size === "1024x1536" || size === "1024x1408") return "1024x1792";
  // Landscape family
  if (size === "1792x1024" || size === "1536x1024" || size === "1408x1024" || size === "1792x768") return "1792x1024";
  // Squares + everything else
  return "1024x1024";
}

async function callProxy(
  path: string,
  init: RequestInit & { modelId?: string; apiKey?: string },
): Promise<Response> {
  const headers = new Headers(init.headers);
  setProxyAuthHeader(headers, init);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}${path}`, { ...init, headers });
  } catch (err) {
    throw new AdapterError("network", `连接代理失败：${(err as Error)?.message ?? err}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code = mapStatus(res.status);
    throw new AdapterError(code, friendlyMsg(code, res.status, text), { status: res.status, details: text });
  }
  return res;
}

function mapStatus(status: number): AdapterError["code"] {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  if (status === 400) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream_5xx";
  return "network";
}

function friendlyMsg(code: AdapterError["code"], status: number, body: string): string {
  // Try to surface upstream error.message if it's a JSON envelope.
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.error?.message ?? parsed?.message ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key": return `OpenAI API Key 无效或没有权限${tail}`;
    case "rate_limited": return `OpenAI 限流${tail}`;
    case "bad_request": return `请求参数被 OpenAI 拒绝${tail}`;
    case "timeout": return `OpenAI 响应超时${tail}`;
    case "upstream_5xx": return `OpenAI 服务异常 (HTTP ${status})${tail}`;
    default: return `OpenAI 请求失败 (HTTP ${status})${tail}`;
  }
}

/**
 * dall-e-3 only accepts these 3 sizes natively. We expose them with their
 * Lumen-canonical values; snapSize() is what bridges other Lumen sizes
 * silently if the user picked something else before switching model.
 */
const DALLE3_SIZE_OPTIONS: Array<{ value: string; label: string; ratio: string }> = [
  { value: "1024x1024", label: "1024×1024", ratio: "1:1" },
  { value: "1792x1024", label: "1792×1024", ratio: "16:9" },
  { value: "1024x1792", label: "1024×1792", ratio: "9:16" },
];

const DALLE2_SIZE_OPTIONS: Array<{ value: string; label: string; ratio: string }> = [
  { value: "1024x1024", label: "1024×1024", ratio: "1:1" },
  { value: "768x768",   label: "512×512",   ratio: "1:1" },
];

function describeDallE3(): ImageParamSpec {
  return {
    size: { mode: "enum", options: DALLE3_SIZE_OPTIONS, default: "1024x1024" },
    // dall-e-3 forces n=1; we emulate batch by parallel calls (cost ×N).
    maxBatch: 4,
    supportsNegativePrompt: false,  // OpenAI DALL·E 不支持 negative prompt
    supportsSeed: false,            // dall-e-3 不接受 seed
    supportsReferenceImages: false, // 图生图走 /v1/images/edits（未接）
    extras: [
      {
        key: "quality",
        label: "画质",
        type: "select",
        default: "standard",
        options: [
          { value: "standard", label: "标准" },
          { value: "hd",       label: "高清（约 2× 价）" },
        ],
      },
      {
        key: "style",
        label: "OpenAI 风格",
        type: "select",
        default: "vivid",
        hint: "vivid = 鲜明戏剧；natural = 自然真实",
        options: [
          { value: "vivid",   label: "鲜明（vivid）" },
          { value: "natural", label: "自然（natural）" },
        ],
      },
    ],
  };
}

function describeDallE2(): ImageParamSpec {
  return {
    size: { mode: "enum", options: DALLE2_SIZE_OPTIONS, default: "1024x1024" },
    maxBatch: 4,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsReferenceImages: false,
  };
}

export const openaiImageAdapter: ProviderAdapter = {
  type: "openai-image",
  kinds: ["image"],

  describeImageParams(modelId) {
    if (modelId === "dall-e-2") return describeDallE2();
    // dall-e-3 is the default; gpt-image-1 needs more code (different
    // response_format), tracked separately.
    return describeDallE3();
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请先填入 API Key");
    const startedAt = Date.now();
    const res = await callProxy("/v1/models", { method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey });
    const json = await res.json().catch(() => ({}));
    const count = Array.isArray(json?.data) ? json.data.length : undefined;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: count ? `账号可用模型 ${count} 个` : "OK",
    };
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") throw new AdapterError("unsupported", "openai-image 不能处理视频请求");
    assertHasAuth(cfg, "请先填入 API Key");

    const params = req.params;
    const size = snapSize(params.size);
    // dall-e-3 forces n=1; emulate batch by issuing parallel calls.
    const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);
    const model = cfg.providerModelId || DEFAULT_MODEL;

    yield { type: "progress", pct: 5, message: "提交到 OpenAI" };

    // OpenAI's image API doesn't stream progress — race the fetch against a
    // tick timer so the UI bar still moves while we wait.
    const startedAt = Date.now();
    const expected = cfg.avgLatencyMs || 7000;
    const fetchPromise = (async () => {
      const calls = Array.from({ length: batch }, () =>
        callProxy("/v1/images/generations", {
          method: "POST",
          modelId: cfg.modelId, apiKey: cfg.apiKey,
          body: JSON.stringify({
            model,
            prompt: req.prompt,
            n: 1,
            size,
            response_format: "url",
            // Adapter-declared extras (currently quality / style for dall-e-3)
            ...(req.params.extras ?? {}),
          }),
          signal: req.signal,
        }).then((r) => r.json()),
      );
      return Promise.all(calls);
    })();

    let done = false;
    const wrappedFetch = fetchPromise.finally(() => { done = true; });

    while (!done) {
      const tick: Promise<"tick"> = new Promise((r) => setTimeout(() => r("tick"), 400));
      const winner = await Promise.race([wrappedFetch.then(() => "done" as const), tick]);
      if (winner === "tick") {
        const pct = Math.min(95, 5 + ((Date.now() - startedAt) / expected) * 90);
        yield { type: "progress", pct };
      }
    }

    const results = await wrappedFetch;
    const urls: string[] = results.flatMap((r) =>
      (Array.isArray(r?.data) ? r.data : []).map((d: { url?: string; b64_json?: string }) =>
        d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : ""),
      ),
    ).filter(Boolean);

    if (urls.length === 0) throw new AdapterError("upstream_5xx", "OpenAI 未返回任何图像");

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "image",
      imageUrls: urls,
      cost: cfg.costPerCall * batch,
    };
  },
};
