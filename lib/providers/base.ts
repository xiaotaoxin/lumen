// Provider adapter contract — single seam between generate.ts and any
// upstream image/video provider (mock, OpenAI, Stability, Replicate, ComfyUI…).
// Built-in models use the "mock" adapter; admin-added custom models pick a
// real one. The proxy (app/api/proxy/*) is what actually attaches the API key
// server-side; adapters running in the browser only know they should hit the
// proxy URL with the X-Lumen-API-Key header.

import type {
  ImageParams,
  ImageParamSpec,
  ModelInfo,
  ModelKind,
  ProviderType,
  VideoParams,
  VideoParamSpec,
} from "../types";

/**
 * Snapshot of the model fields an adapter cares about. Decoupled from
 * ModelInfo so adapters don't pull in the full domain type.
 */
export interface ProviderConfig {
  providerType: ProviderType;
  /** Upstream model id ("dall-e-3", "stable-diffusion-xl-1024-v1-0", …) */
  providerModelId?: string;
  /** Custom endpoint (mostly for ComfyUI / Generic-HTTP) */
  endpoint?: string;
  /**
   * Stage-2 推荐路径：lumen.db 里的 ModelInfo.id。adapter 调 proxy 时只送
   * X-Lumen-Model-Id，server 反查解密 Key 后再签名上游。浏览器永远不见明文。
   */
  modelId?: string;
  /**
   * Stage-1 兼容路径：明文 API Key。仅 admin UI 的"测试连接"草稿态使用
   * （此时 ModelInfo 还没保存到 DB，没有 modelId 可用）。正常运行时为 undefined。
   */
  apiKey?: string;
  /** Pulled through for cost reporting in the final result. */
  costPerCall: number;
  /** Used by the mock adapter; ignored by real adapters. */
  avgLatencyMs: number;
  baseFailureRate: number;
}

/**
 * Adapter 入口前置鉴权检查 —— stage-2 下浏览器端拿不到明文 apiKey，
 * 只要 cfg.modelId（lumen.db 行 id）或 cfg.apiKey（草稿态明文）任一存在即可放行。
 * proxy 服务端会做最终鉴权（解密 / 401）。
 */
export function assertHasAuth(cfg: ProviderConfig, missingMessage: string): void {
  if (!cfg.modelId && !cfg.apiKey) {
    throw new AdapterError("invalid_key", missingMessage);
  }
}

export function modelToProviderConfig(m: ModelInfo): ProviderConfig {
  return {
    providerType: m.providerType ?? "mock",
    providerModelId: m.providerModelId,
    endpoint: m.endpoint,
    modelId: m.id,                // ← stage-2 推荐路径
    apiKey: m.apiKey,             // ← 仅当 ModelInfo 上还有明文（草稿态）才有值；正常 GET 回来恒为 undefined
    costPerCall: m.costPerCall,
    avgLatencyMs: m.avgLatencyMs,
    baseFailureRate: m.baseFailureRate,
  };
}

export interface ImageGenerateRequest {
  kind: "image";
  prompt: string;
  params: ImageParams;
  signal?: AbortSignal;
}

export interface VideoGenerateRequest {
  kind: "video";
  prompt: string;
  params: VideoParams;
  signal?: AbortSignal;
}

export type GenerateRequest = ImageGenerateRequest | VideoGenerateRequest;

export interface ProgressEvent {
  type: "progress";
  /** 0..100 */
  pct: number;
  /** Optional message for richer status (e.g. "排队中" / "渲染中") */
  message?: string;
}

export interface ImageFinalResult {
  type: "final";
  kind: "image";
  imageUrls: string[];
  cost: number;
}

export interface VideoFinalResult {
  type: "final";
  kind: "video";
  videoUrl: string;
  videoPosterUrl?: string;
  cost: number;
}

export type FinalResult = ImageFinalResult | VideoFinalResult;

export type AdapterEvent = ProgressEvent | FinalResult;

export interface TestResult {
  ok: boolean;
  /** Latency of the test call, ms — useful for the admin UI */
  latencyMs: number;
  /** Free-form upstream message (model count, account info, …) */
  message?: string;
}

/**
 * Adapter side of the seam. Each implementation is an isolated module that
 * knows how to talk to one upstream (or is the mock). generate() is an async
 * generator so progress + final flow back through the same channel.
 */
export interface ProviderAdapter {
  type: ProviderType;
  /** Which media this adapter produces — used by the registry for sanity checks. */
  kinds: ModelKind[];
  /**
   * Validate a config without consuming credits where possible. For
   * providers without a free probe endpoint, fall back to a 1×low-res call.
   */
  testCall(cfg: ProviderConfig): Promise<TestResult>;
  /** Stream progress events, then exactly one FinalResult. */
  generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent>;
  /**
   * Optional per-model UI capability declaration. UI uses this to decide
   * which inputs to render (size options, batch picker, negative prompt,
   * seed, references, plus any model-specific "advanced" params).
   * Falls back to DEFAULT_IMAGE_SPEC when absent — UI looks unchanged.
   */
  describeImageParams?(modelId: string | undefined): ImageParamSpec;
  describeVideoParams?(modelId: string | undefined): VideoParamSpec;
}

/**
 * Normalized error type that all adapters throw (or wrap). The UI maps codes
 * → friendly Chinese strings; raw upstream messages go in `details`.
 */
export type AdapterErrorCode =
  | "cors"
  | "invalid_key"
  | "quota_exceeded"
  | "rate_limited"
  | "upstream_5xx"
  | "timeout"
  | "bad_request"
  | "network"
  | "cancelled"
  | "unsupported";

export class AdapterError extends Error {
  code: AdapterErrorCode;
  /** HTTP status if applicable */
  status?: number;
  /** Raw upstream message for debug surfacing */
  details?: string;
  constructor(code: AdapterErrorCode, message: string, opts?: { status?: number; details?: string }) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.status = opts?.status;
    this.details = opts?.details;
  }
}

export function friendlyAdapterMessage(code: AdapterErrorCode): string {
  switch (code) {
    case "cors": return "上游拦截了浏览器请求（CORS）。请通过代理调用。";
    case "invalid_key": return "API Key 无效或已过期";
    case "quota_exceeded": return "上游额度已用完";
    case "rate_limited": return "请求过于频繁，请稍后再试";
    case "upstream_5xx": return "上游服务暂时不可用，请重试";
    case "timeout": return "上游响应超时";
    case "bad_request": return "请求参数被上游拒绝";
    case "network": return "网络错误，请检查连接";
    case "cancelled": return "已取消";
    case "unsupported": return "当前模型不支持该操作";
  }
}
