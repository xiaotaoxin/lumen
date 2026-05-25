// 火山方舟 Ark · Seedream 图像 adapter
//
// 平台：ark.cn-beijing.volces.com/api/v3
// 鉴权：Bearer ARK_API_KEY（与 OpenAI 完全兼容的格式）
//
// 端点：POST /api/v3/images/generations
// Body: { model, prompt, size?, watermark?, response_format?, n?, seed? }
// Response: { data: [{ url, b64_json? }], usage }
//
// 推荐 model（按优先级，2026-05）：
//   doubao-seedream-5-0           ⭐ 旗舰
//   doubao-seedream-5-0-lite      Lite，更便宜
//   doubao-seedream-4-5
//   doubao-seedream-4-0

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

const PROXY_BASE = "/api/proxy/ark";
const DEFAULT_MODEL = "doubao-seedream-5-0";

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

interface ImagesGenerationsResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
}

/* ───────────────────────── Capability spec ───────────────────────── */

function describeArkImage(): ImageParamSpec {
  return {
    size: {
      mode: "enum",
      default: "1024x1024",
      options: [
        { value: "1024x1024", label: "1024×1024", ratio: "1:1" },
        { value: "1024x1792", label: "1024×1792", ratio: "9:16" },
        { value: "1792x1024", label: "1792×1024", ratio: "16:9" },
        { value: "1024x1536", label: "1024×1536", ratio: "2:3" },
        { value: "1536x1024", label: "1536×1024", ratio: "3:2" },
        { value: "2048x2048", label: "2K (2048×2048)", ratio: "1:1" },
      ],
    },
    maxBatch: 4,
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsReferenceImages: true,
    maxReferenceImages: 4,
    extras: [
      {
        key: "watermark", label: "AI 生成水印", type: "boolean",
        default: false,
      },
      {
        key: "response_format", label: "返回格式", type: "select",
        default: "url",
        options: [
          { value: "url",      label: "url（默认）" },
          { value: "b64_json", label: "b64_json（base64 内嵌）" },
        ],
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const arkImageAdapter: ProviderAdapter = {
  type: "ark-image",
  kinds: ["image"],

  describeImageParams() {
    return describeArkImage();
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请填入火山方舟 API Key");
    const startedAt = Date.now();
    try {
      // 用一个空 prompt 探活：401/403 = key 无效；4xx = key OK
      const res = await callProxy("/api/v3/images/generations", {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify({ model: DEFAULT_MODEL, prompt: "" }),
      });
      await res.json().catch(() => null);
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") throw new AdapterError("unsupported", "ark-image 不能处理视频请求");
    assertHasAuth(cfg, "请填入火山方舟 API Key");

    const model = cfg.providerModelId || DEFAULT_MODEL;
    const params = req.params;
    const extras = (params.extras ?? {}) as Record<string, unknown>;
    const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);

    const body: Record<string, unknown> = {
      model,
      prompt: req.prompt,
      n: batch,
    };
    if (params.size) body.size = params.size;
    if (typeof params.seed === "number") body.seed = params.seed;
    if (typeof extras.watermark === "boolean") body.watermark = extras.watermark;
    if (typeof extras.response_format === "string") body.response_format = extras.response_format;

    // 参考图（图生图 / 编辑场景）—— Ark Seedream 接受 image_urls
    const refs = (params.references ?? []).filter(
      (r): r is string => typeof r === "string" && r.length > 0 && r !== "ref:omitted",
    );
    if (refs.length > 0) {
      body.image = refs.length === 1 ? refs[0] : refs;
    }

    yield { type: "progress", pct: 5, message: "提交到火山方舟" };

    // 同步路径：单次 POST 直接拿结果。开 race tick 让进度条爬动
    const expected = cfg.avgLatencyMs || 12000;
    const startedAt = Date.now();
    const fetchPromise = (async () => {
      const res = await callProxy("/api/v3/images/generations", {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify(body),
        signal: req.signal,
      });
      return (await res.json()) as ImagesGenerationsResponse;
    })();
    let done = false;
    const wrapped = fetchPromise.finally(() => { done = true; });
    while (!done) {
      const tick: Promise<"tick"> = new Promise((r) => setTimeout(() => r("tick"), 500));
      const winner = await Promise.race([wrapped.then(() => "done" as const), tick]);
      if (winner === "tick") {
        yield { type: "progress", pct: Math.min(95, 5 + ((Date.now() - startedAt) / expected) * 90) };
      }
    }

    const resp = await wrapped;
    if (resp.error?.message) {
      throw new AdapterError("upstream_5xx", `火山方舟返回错误：${resp.error.message}`);
    }

    const urls: string[] = [];
    for (const item of resp.data ?? []) {
      if (typeof item.url === "string" && item.url.length > 0) urls.push(item.url);
      else if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
        urls.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
    if (urls.length === 0) throw new AdapterError("upstream_5xx", "火山方舟未返回任何图像");

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "image",
      imageUrls: urls,
      cost: cfg.costPerCall * batch,
    };
  },
};
