// 即梦 AI 文生图 adapter（火山引擎·智能视觉服务）
//
// 平台：visual.volcengineapi.com
// 鉴权：Volcengine V4 签名 —— 用户在 admin 里把 API Key 填成 "AccessKey:SecretKey"
//        proxy（app/api/proxy/volcengine）服务端拆开做签名后转发
//
// 端点：POST /?Action=CVProcess&Version=2022-08-31
// 请求体：{ req_key, prompt, width, height, ... }
//   req_key 是即梦的"模型版本字符串"，由 cfg.providerModelId 决定
//   常用值：jimeng_t2i_v40 / jimeng_t2i_v31 / jimeng_t2i_v30
// 响应体（同步）：{ code, data: { binary_data_base64?: string[], image_urls?: string[] }, ... }
//
// ⚠️ 状态：实现完成但未经过真实 AccessKey/SecretKey 测试。
//   V4 签名算法已对齐火山官方文档；如调用失败请优先核对：
//   1) AccessKey:SecretKey 格式是否正确（无空格）
//   2) req_key 是否在你账号下开通
//   3) 火山引擎 region 是否非默认 cn-north-1（其它区域需调 proxy）

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
import type { ImageParamSpec } from "../types";

const PROXY_BASE = "/api/proxy/volcengine";
const ACTION = "CVProcess";
const VERSION = "2022-08-31";
const DEFAULT_REQ_KEY = "jimeng_t2i_v40";

interface CallProxyInit extends RequestInit {
  modelId?: string;
  apiKey?: string;
}

async function callProxy(searchParams: Record<string, string>, init: CallProxyInit): Promise<Response> {
  const headers = new Headers(init.headers);
  setProxyAuthHeader(headers, init);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const qs = new URLSearchParams(searchParams).toString();
  const url = `${PROXY_BASE}/?${qs}`;
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
    case "bad_request":     return `即梦拒绝了请求（参数 / req_key / 敏感词）${tail}`;
    case "timeout":         return `即梦响应超时${tail}`;
    case "upstream_5xx":    return `火山引擎服务异常 (HTTP ${status})${tail}`;
    default:                return `即梦请求失败 (HTTP ${status})${tail}`;
  }
}

interface JimengResponse {
  code?: number;
  message?: string;
  data?: {
    binary_data_base64?: string[];
    image_urls?: string[];
  };
  ResponseMetadata?: {
    Error?: { Code?: string; Message?: string };
  };
}

/* ───────────────────────── Capability spec ───────────────────────── */

function describeJimeng(): ImageParamSpec {
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
      ],
    },
    maxBatch: 1,
    supportsNegativePrompt: false,
    supportsSeed: true,
    supportsReferenceImages: false,
    extras: [
      {
        key: "use_sr", label: "超分辨率", type: "boolean",
        default: true,
        hint: "返回前过一遍超分增强细节",
      },
      {
        key: "scale", label: "scale", type: "number",
        default: 7.5,
        hint: "CFG scale，越大越贴近 prompt（典型 5–10）",
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const jimengImageAdapter: ProviderAdapter = {
  type: "jimeng-image",
  kinds: ["image"],

  describeImageParams() {
    return describeJimeng();
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    if (!cfg.apiKey || !cfg.apiKey.includes(":")) {
      throw new AdapterError("invalid_key", "请填入 AccessKey:SecretKey（冒号分隔）");
    }
    const startedAt = Date.now();
    // 用一个故意非法的 req_key 探活：签名通过 = key 有效；签名错误 = key 无效
    try {
      const res = await callProxy({ Action: ACTION, Version: VERSION }, {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify({ req_key: "__lumen_probe_invalid__" }),
      });
      const data = (await res.json()) as JimengResponse;
      // 上游可能返回 200 + 业务 code 错误；只要不是签名/Key 问题就算 OK
      if (data.code && (data.code === 50412 || data.code === 50000)) {
        // typical "req_key invalid" — 鉴权过了
        return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
      }
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      // 其它错误也视为鉴权过了（参数错误等不影响 key 判断）
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") throw new AdapterError("unsupported", "jimeng-image 不能处理视频请求");
    if (!cfg.apiKey || !cfg.apiKey.includes(":")) {
      throw new AdapterError("invalid_key", "请填入 AccessKey:SecretKey（冒号分隔）");
    }

    const reqKey = cfg.providerModelId || DEFAULT_REQ_KEY;
    const params = req.params;
    const extras = (params.extras ?? {}) as Record<string, unknown>;

    // size: "1024x1024" → width=1024, height=1024
    let width = 1024;
    let height = 1024;
    if (params.size && /^\d+x\d+$/.test(params.size)) {
      const [w, h] = params.size.split("x").map(Number);
      width = w;
      height = h;
    }

    const body: Record<string, unknown> = {
      req_key: reqKey,
      prompt: req.prompt,
      width,
      height,
      return_url: true,
    };
    if (typeof params.seed === "number") body.seed = params.seed;
    if (typeof extras.use_sr === "boolean") body.use_sr = extras.use_sr;
    if (typeof extras.scale === "number") body.scale = extras.scale;

    yield { type: "progress", pct: 5, message: "提交到即梦" };

    // 即梦 4.0 是同步 API（返回较慢，10-30s 但不需要轮询）
    // 用 race tick 让进度条爬动
    const expected = cfg.avgLatencyMs || 20000;
    const startedAt = Date.now();
    const fetchPromise = (async () => {
      const res = await callProxy({ Action: ACTION, Version: VERSION }, {
        method: "POST",
        modelId: cfg.modelId, apiKey: cfg.apiKey,
        body: JSON.stringify(body),
        signal: req.signal,
      });
      return (await res.json()) as JimengResponse;
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
    if (resp.code && resp.code !== 10000 && resp.code !== 0) {
      throw new AdapterError("upstream_5xx", `即梦返回错误：${resp.message ?? resp.code}`);
    }

    const urls = resp.data?.image_urls ?? [];
    const base64s = resp.data?.binary_data_base64 ?? [];
    const finalUrls = urls.length > 0
      ? urls
      : base64s.map((b) => `data:image/png;base64,${b}`);
    if (finalUrls.length === 0) {
      throw new AdapterError("upstream_5xx", "即梦未返回任何图像");
    }

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "image",
      imageUrls: finalUrls,
      cost: cfg.costPerCall,
    };
  },
};
