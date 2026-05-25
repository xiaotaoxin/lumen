// 阿里云百炼（DashScope）图像适配器
//
// 推荐模型 ID（按优先级）：
//   wan2.7-image-pro       ⭐ 最强 · 4K 输出 · thinking_mode
//   wan2.7-image           更快 · 2K 输出
//   wan2.6-image / wan2.6-t2i
//   wanx2.1-t2i-turbo（老）速度快、便宜，2K 内
//   wanx2.1-t2i-plus（老）质量更高，2K 内
//
// **两套 API 形态**（adapter 自动按 modelId 分流）：
//
// A. wan2.6+ / wan2.7+ —— sync chat-style，单次 POST 直接拿结果
//    POST /api/v1/services/aigc/multimodal-generation/generation
//    Body: { model, input: { messages: [{role:"user", content:[{text:"..."}]}] }, parameters: {...} }
//    Resp: output.choices[0].message.content[i].image （URL）
//    parameters: size("1K"/"2K"/"4K" 或像素串)、n(1-4)、watermark、thinking_mode、seed、color_palette
//
// B. wanx2.1 / wan2.5 老代 —— async task
//    POST /api/v1/services/aigc/text2image/image-synthesis  + X-DashScope-Async: enable
//    Body: { model, input: { prompt }, parameters: { size, n, negative_prompt, seed, prompt_extend } }
//    再轮询 /api/v1/tasks/{id}，取 output.results[].url

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

const PROXY_BASE = "/api/proxy/dashscope";
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_MODEL = "wan2.7-image-pro";

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
  if (status === 429 || /Throttling|RateLimit/i.test(body)) return "rate_limited";
  if (status === 400 || status === 422) return "bad_request";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "upstream_5xx";
  if (/InvalidApiKey|InvalidAccessKeyId/i.test(body)) return "invalid_key";
  return "network";
}

function friendlyMsg(code: AdapterErrorCode, status: number, body: string): string {
  let upstream = "";
  try {
    const parsed = JSON.parse(body);
    upstream = parsed?.message ?? parsed?.code ?? "";
  } catch { /* not JSON */ }
  const tail = upstream ? `：${upstream}` : "";
  switch (code) {
    case "invalid_key":  return `百炼 API Key 无效或没有权限${tail}`;
    case "rate_limited": return `百炼限流（QPS / 配额超限）${tail}`;
    case "bad_request":  return `百炼拒绝了请求（参数或模型 ID 问题）${tail}`;
    case "timeout":      return `百炼响应超时${tail}`;
    case "upstream_5xx": return `百炼服务异常 (HTTP ${status})${tail}`;
    default:             return `百炼请求失败 (HTTP ${status})${tail}`;
  }
}

/** 老 API 的轮询响应 */
interface OldTaskResponse {
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
    results?: Array<{ url?: string; code?: string; message?: string }>;
    message?: string;
    code?: string;
  };
}

/** 新 sync API 的响应 */
interface NewSyncResponse {
  output?: {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        role?: string;
        content?: Array<{ type?: string; image?: string; text?: string }>;
      };
    }>;
    finished?: boolean;
  };
  usage?: { image_count?: number };
}

/* ───────────────────────── Capability spec ───────────────────────── */

/**
 * 三种 API 路径：
 * - 新 sync multimodal-generation：wan2.6+ / wan2.7+ / qwen-image
 * - 新 async image-generation/generation（messages 体）：kling/*
 * - 老 async text2image：wanx2.1 / wan2.5-
 */
function isNewGen(modelId: string | undefined): boolean {
  if (!modelId) return true;
  return /^wan2\.[6-9]/.test(modelId)
    || /^wan[3-9]/.test(modelId)
    || /^qwen-image/.test(modelId);
}

/** qwen-image 系列不支持 wan 专属的 thinking_mode / watermark 参数 */
function isQwenImage(modelId: string | undefined): boolean {
  return !!modelId && /^qwen-image/.test(modelId);
}

/** 可灵 image：kling/kling-v3-image-generation / kling/kling-v3-omni-image-generation 等 */
function isKlingImage(modelId: string | undefined): boolean {
  return !!modelId && /^kling\//.test(modelId);
}

/**
 * 把 UI 里各种 size 写法归一化成百炼新 sync API 接受的 `width*height` 像素格式。
 *
 * - `1K` / `2K` / `4K` 别名 → 实际像素（qwen-image 不接受别名，只认像素；
 *   wan 两种都行，统一用像素更安全）。
 * - `1024x1024` / `1024×1024`（lowercase x 或全角 ×） → `1024*1024`。
 * - 已经是 `width*height` → 原样返回。
 * - 兜底返回 `1024*1024`。
 */
/**
 * 不同 wan 子代的总像素上限：
 *   wan2.6:        589,824 ~ 2,073,600     （即 768² ~ ~1440² / 1920×1080）
 *   wan2.7 非 pro: ~2K 范围内               （2048² 经验值上限）
 *   wan2.7-*-pro:  支持 4K（4096²）
 *   qwen-image:    ~2K 范围
 *
 * 把超限的 2K/4K 按上限折算到合规分辨率，避免上游 400 "Total pixels must be between..."
 */
function clampPixelsForModel(modelId: string | undefined, sized: string): string {
  const m = sized.match(/^(\d+)\*(\d+)$/);
  if (!m) return sized;
  const w = Number(m[1]);
  const h = Number(m[2]);
  const px = w * h;
  const id = modelId ?? "";
  // wan2.6 系列硬上限 2,073,600
  if (/^wan2\.6/.test(id) && px > 2_073_600) {
    if (w === h) return "1440*1440";              // 2K → 1440²
    const ratio = w / h;
    if (ratio > 1) return "1920*1080";            // 横屏 max
    return "1080*1920";                           // 竖屏 max
  }
  // wan2.7 非 pro 上限 ~ 4,194,304（2K = 2048²）
  if (/^wan2\.7/.test(id) && !/-pro/.test(id) && px > 4_194_304) {
    return "2048*2048";
  }
  return sized;
}

function normalizeNewGenSize(size: string | undefined): string {
  if (!size) return "1024*1024";
  const trimmed = size.trim();
  if (trimmed === "1K") return "1024*1024";
  if (trimmed === "2K") return "2048*2048";
  if (trimmed === "4K") return "4096*4096";
  if (/^\d+\s*[x×*]\s*\d+$/.test(trimmed)) {
    return trimmed.replace(/\s*[x×]\s*/g, "*").replace(/\s+/g, "");
  }
  return "1024*1024";
}

const NEW_SIZE_OPTIONS_BASE = [
  { value: "1K", label: "1K (1024×1024)", ratio: "1:1" },
  { value: "2K", label: "2K (2048×2048)", ratio: "1:1" },
  { value: "1024*1792", label: "1K 9:16 (1024×1792)", ratio: "9:16" },
  { value: "1792*1024", label: "1K 16:9 (1792×1024)", ratio: "16:9" },
  { value: "1248*832",  label: "1K 3:2 (1248×832)",   ratio: "3:2" },
  { value: "832*1248",  label: "1K 2:3 (832×1248)",   ratio: "2:3" },
];

const OLD_SIZE_OPTIONS = [
  { value: "1024x1024", label: "1024×1024", ratio: "1:1" },
  { value: "1792x1024", label: "1280×720",  ratio: "16:9" },
  { value: "1024x1792", label: "720×1280",  ratio: "9:16" },
  { value: "1536x1024", label: "1152×768",  ratio: "3:2" },
  { value: "1024x1536", label: "768×1152",  ratio: "2:3" },
];

function describeNewGen(modelId: string | undefined): ImageParamSpec {
  const id = modelId ?? "";
  const isPro = id.includes("-pro");
  const isMax = id.includes("-max");
  const isPlus = id.includes("-plus");
  const isFlash = id.includes("-flash");
  const isWan26 = /^wan2\.6/.test(id);
  const isWan27 = /^wan2\.7/.test(id);
  const isQwenEdit = /^qwen-image-edit/.test(id);
  const isQwen = isQwenImage(id);

  /* ── size ── */

  const oneKSet = [
    { value: "1K", label: "1K (1024×1024)", ratio: "1:1" },
    { value: "1024*1792", label: "1K 9:16 (1024×1792)", ratio: "9:16" },
    { value: "1792*1024", label: "1K 16:9 (1792×1024)", ratio: "16:9" },
    { value: "1248*832",  label: "1K 3:2 (1248×832)",   ratio: "3:2" },
    { value: "832*1248",  label: "1K 2:3 (832×1248)",   ratio: "2:3" },
  ];

  const sizeOptions: typeof oneKSet = [...oneKSet];
  if (isWan26) {
    sizeOptions.push(
      { value: "1440*1440", label: "Max 1:1 (1440×1440)", ratio: "1:1" },
      { value: "1920*1080", label: "Max 16:9 (1920×1080)", ratio: "16:9" },
      { value: "1080*1920", label: "Max 9:16 (1080×1920)", ratio: "9:16" },
    );
  } else {
    sizeOptions.push({ value: "2K", label: "2K (2048×2048)", ratio: "1:1" });
    if (isPro && isWan27) {
      sizeOptions.push({ value: "4K", label: "4K (4096×4096)", ratio: "1:1" });
    }
  }

  /* ── extras (model-specific) ── */

  const extras: NonNullable<ImageParamSpec["extras"]> = [];

  // 智能提示词扩写 —— wan / qwen-image 都支持
  extras.push({
    key: "prompt_extend", label: "智能提示词扩写", type: "boolean",
    default: true,
    hint: "调用大模型把短 prompt 改写得更完整，提升出图质量；关掉可加速。",
  });

  // wan2.7-*-pro 独有：深度思考模式
  if (isWan27 && isPro) {
    extras.push({
      key: "thinking_mode", label: "深度思考模式", type: "boolean",
      default: true,
      hint: "开启提升画质但耗时多 ~30%。仅 wan2.7-*-pro 支持。",
    });
  }

  // qwen-image-* 系列档位提示
  if (isQwen && (isMax || isPlus)) {
    extras.push({
      key: "_tier_note", label: `档位说明 · ${isMax ? "Max" : "Plus"}`, type: "boolean",
      default: false,
      hint: isMax
        ? "Max 真实感最强、AI 痕迹最低；输出固定 1 张图（批量参数无效）。"
        : "Plus 多艺术风格 + 文字渲染，速度比 Max 快。",
    });
  }

  // qwen-image-edit 专属：编辑强度
  if (isQwenEdit) {
    extras.push({
      key: "edit_strength", label: "编辑强度", type: "number",
      default: 0.7,
      hint: "0~1。值越大越偏离原图、越听 prompt；0.5-0.8 通常合适。",
    });
  }

  // 所有 wan + qwen 都接受水印开关
  extras.push({
    key: "watermark", label: "AI 生成水印", type: "boolean",
    default: false,
    hint: "右下角加上『AI 生成』水印（合规需要）。",
  });

  // wan2.7 全系：色板锁定
  if (isWan27) {
    extras.push({
      key: "color_palette", label: "色板锁定（hex 数组）", type: "text",
      hint: "可选 · JSON 数组，如 [\"#fff\",\"#000\",\"#ff0000\"]，引导画面用这些主色。",
    });
  }

  // wan2.6-* 加速版（非 pro 非 max）：低耗模式提示
  if ((isWan26 || isFlash) && !isPro && !isMax) {
    extras.push({
      key: "_speed_note", label: "档位说明 · 经济档", type: "boolean",
      default: false,
      hint: `${isWan26 ? "wan2.6 标准" : "Flash"} 档位偏速度，质量略低于 pro。换 *-pro 可获更高画质。`,
    });
  }

  /* ── 其它 capability ── */

  // qwen-image-edit 必须传参考图（待编辑的原图）；其它都不需要
  const supportsRef = isQwenEdit;
  const requiresRef = isQwenEdit;

  // wan / qwen-image 同步端点都支持 negative_prompt（之前的 false 是误判）
  const supportsNeg = !isQwenEdit;          // 编辑模式不支持负向

  // qwen-image-max 文档说固定 1 张，其它 1-4
  const maxBatch = isQwen && isMax ? 1 : 4;

  return {
    size: { mode: "enum", options: sizeOptions, default: isWan26 ? "1440*1440" : "1K" },
    maxBatch,
    supportsNegativePrompt: supportsNeg,
    supportsSeed: !isQwenEdit,
    supportsReferenceImages: supportsRef,
    maxReferenceImages: supportsRef ? 1 : undefined,
    extras,
  };
}

function describeKling(): ImageParamSpec {
  return {
    size: {
      mode: "enum",
      default: "1K",
      options: [
        { value: "1K", label: "1K", ratio: "auto" },
        { value: "2K", label: "2K", ratio: "auto" },
      ],
    },
    maxBatch: 4,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsReferenceImages: true,
    maxReferenceImages: 4,
    extras: [
      {
        key: "aspect_ratio", label: "画面比例", type: "select",
        default: "1:1",
        options: [
          { value: "1:1",  label: "1:1" },
          { value: "16:9", label: "16:9" },
          { value: "9:16", label: "9:16" },
          { value: "4:3",  label: "4:3" },
          { value: "3:4",  label: "3:4" },
        ],
      },
    ],
  };
}

function describeOldGen(): ImageParamSpec {
  return {
    size: { mode: "enum", options: OLD_SIZE_OPTIONS, default: "1024x1024" },
    maxBatch: 4,
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsReferenceImages: false,
    extras: [
      {
        key: "prompt_extend", label: "智能提示词扩写", type: "boolean",
        default: true,
        hint: "用通义千问扩展中文提示词，对短 prompt 提升明显",
      },
    ],
  };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const dashscopeImageAdapter: ProviderAdapter = {
  type: "dashscope-image",
  kinds: ["image"],

  describeImageParams(modelId) {
    if (isKlingImage(modelId)) return describeKling();
    return isNewGen(modelId) ? describeNewGen(modelId) : describeOldGen();
  },

  async testCall(cfg: ProviderConfig): Promise<TestResult> {
    assertHasAuth(cfg, "请先填入百炼 API Key（sk-...）");
    const startedAt = Date.now();
    const fakeId = "00000000-0000-0000-0000-000000000000";
    try {
      await callProxy(`/api/v1/tasks/${fakeId}`, { method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey });
      return { ok: true, latencyMs: Date.now() - startedAt, message: "OK" };
    } catch (err) {
      if (err instanceof AdapterError && err.code === "invalid_key") throw err;
      return { ok: true, latencyMs: Date.now() - startedAt, message: "鉴权通过" };
    }
  },

  async *generate(cfg: ProviderConfig, req: GenerateRequest): AsyncIterable<AdapterEvent> {
    if (req.kind !== "image") throw new AdapterError("unsupported", "dashscope-image 不能处理视频请求");
    assertHasAuth(cfg, "请先填入百炼 API Key（sk-...）");

    const model = cfg.providerModelId || DEFAULT_MODEL;
    if (isKlingImage(model)) {
      yield* generateKlingAsync(cfg, model, req);
    } else if (isNewGen(model)) {
      yield* generateNewSync(cfg, model, req);
    } else {
      yield* generateOldAsync(cfg, model, req);
    }
  },
};

/* ─────────── 新 sync 路径（wan2.6+ / wan2.7+） ─────────── */

async function* generateNewSync(
  cfg: ProviderConfig,
  model: string,
  req: Extract<GenerateRequest, { kind: "image" }>,
): AsyncIterable<AdapterEvent> {
  const params = req.params;
  const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);
  const extras = (params.extras ?? {}) as Record<string, unknown>;

  const parameters: Record<string, unknown> = {
    size: clampPixelsForModel(model, normalizeNewGenSize(params.size)),
    n: batch,
  };
  if (typeof params.seed === "number") parameters.seed = params.seed;
  // wan 专属参数；qwen-image 系列不接受这些字段
  if (!isQwenImage(model)) {
    for (const k of ["thinking_mode", "watermark", "color_palette"] as const) {
      if (extras[k] !== undefined && extras[k] !== "") parameters[k] = extras[k];
    }
  }

  yield { type: "progress", pct: 5, message: "提交到百炼" };

  // sync 路径：单次 POST 直接拿最终响应。开 race tick 让进度条爬动
  const expected = cfg.avgLatencyMs || 12000;
  const startedAt = Date.now();
  const fetchPromise = (async () => {
    const res = await callProxy("/api/v1/services/aigc/multimodal-generation/generation", {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      body: JSON.stringify({
        model,
        input: { messages: [{ role: "user", content: [{ text: req.prompt }] }] },
        parameters,
      }),
      signal: req.signal,
    });
    return (await res.json()) as NewSyncResponse;
  })();
  let done = false;
  const wrapped = fetchPromise.finally(() => { done = true; });

  while (!done) {
    const tick: Promise<"tick"> = new Promise((r) => setTimeout(() => r("tick"), 500));
    const winner = await Promise.race([wrapped.then(() => "done" as const), tick]);
    if (winner === "tick") {
      const pct = Math.min(95, 5 + ((Date.now() - startedAt) / expected) * 90);
      yield { type: "progress", pct };
    }
  }

  const resp = await wrapped;
  const urls: string[] = [];
  for (const choice of resp.output?.choices ?? []) {
    for (const item of choice.message?.content ?? []) {
      // qwen-image：{ image: "url" }（没有 type 字段）
      // wan2.7：    { type: "image", image: "url" }
      // 都按 image 字段是 URL 字符串识别即可。
      if (typeof item?.image === "string" && item.image.length > 0) {
        urls.push(item.image);
      }
    }
  }
  if (urls.length === 0) throw new AdapterError("upstream_5xx", "百炼未返回任何图像（响应为空）");

  yield { type: "progress", pct: 99 };
  yield {
    type: "final",
    kind: "image",
    imageUrls: urls,
    cost: cfg.costPerCall * batch,
  };
}

/* ─────────── 老 async 路径（wanx2.1 / wan2.5- / wan2.2-） ─────────── */

function snapOldSize(size: string | undefined): string {
  if (!size || size === "auto") return "1024*1024";
  // 兼容 Lumen 的 "x" 写法 → DashScope 老 API 用 "*"
  if (size.includes("x") && !size.includes("*")) {
    const [w, h] = size.split("x");
    if (w === h) return "1024*1024";
    if (size === "1024x1792") return "720*1280";
    if (size === "1792x1024") return "1280*720";
    if (size === "1024x1536" || size === "1024x1408") return "768*1152";
    if (size === "1536x1024" || size === "1408x1024") return "1152*768";
    if (size === "1792x768") return "1280*720";
    return "1024*1024";
  }
  return size;
}

async function* generateOldAsync(
  cfg: ProviderConfig,
  model: string,
  req: Extract<GenerateRequest, { kind: "image" }>,
): AsyncIterable<AdapterEvent> {
  const params = req.params;
  const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);
  const extras = (params.extras ?? {}) as Record<string, unknown>;

  const parameters: Record<string, unknown> = {
    size: snapOldSize(params.size),
    n: batch,
    ...extras,
  };
  if (params.negativePrompt) parameters.negative_prompt = params.negativePrompt;
  if (typeof params.seed === "number") parameters.seed = params.seed;

  yield { type: "progress", pct: 5, message: "提交到百炼" };

  // 1) 创建任务
  const createRes = await callProxy("/api/v1/services/aigc/text2image/image-synthesis", {
    method: "POST",
    modelId: cfg.modelId, apiKey: cfg.apiKey,
    headers: { "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model,
      input: { prompt: req.prompt },
      parameters,
    }),
    signal: req.signal,
  });
  const created: OldTaskResponse = await createRes.json();
  const taskId = created?.output?.task_id;
  if (!taskId) {
    throw new AdapterError("upstream_5xx", `百炼未返回 task_id：${created?.output?.message ?? JSON.stringify(created)}`);
  }

  // 2) 轮询
  const startedAt = Date.now();
  const expected = cfg.avgLatencyMs || 8000;
  let task: OldTaskResponse = created;

  while (
    task.output?.task_status !== "SUCCEEDED" &&
    task.output?.task_status !== "FAILED" &&
    task.output?.task_status !== "CANCELED" &&
    task.output?.task_status !== "UNKNOWN"
  ) {
    if (req.signal?.aborted) {
      void callProxy(`/api/v1/tasks/${taskId}/cancel`, { method: "POST", modelId: cfg.modelId, apiKey: cfg.apiKey }).catch(() => {});
      throw new AdapterError("cancelled", "已取消");
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > MAX_WAIT_MS) throw new AdapterError("timeout", "百炼长时间未返回，已超时");
    yield { type: "progress", pct: Math.min(95, 5 + (elapsed / expected) * 90) };
    await sleep(POLL_INTERVAL_MS, req.signal);
    const pollRes = await callProxy(`/api/v1/tasks/${taskId}`, {
      method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
    });
    task = await pollRes.json();
  }

  if (task.output?.task_status !== "SUCCEEDED") {
    const errMsg = task.output?.message ?? task.output?.code ?? task.output?.task_status;
    throw new AdapterError(
      task.output?.task_status === "CANCELED" ? "cancelled" : "upstream_5xx",
      `百炼生成失败：${errMsg}`,
    );
  }

  const results = task.output.results ?? [];
  const urls = results.map((r) => r.url).filter((x): x is string => typeof x === "string" && x.length > 0);
  if (urls.length === 0) {
    const firstErr = results.find((r) => r.message)?.message;
    throw new AdapterError("upstream_5xx", firstErr ? `百炼未返回图像：${firstErr}` : "百炼未返回任何图像");
  }

  yield { type: "progress", pct: 99 };
  yield {
    type: "final",
    kind: "image",
    imageUrls: urls,
    cost: cfg.costPerCall * batch,
  };
}

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

/* ─────────── 可灵 image：messages 体 + async 轮询 ─────────── */

interface KlingTaskResponse {
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string; text?: string }>;
      };
    }>;
    message?: string;
    code?: string;
  };
}

async function* generateKlingAsync(
  cfg: ProviderConfig,
  model: string,
  req: Extract<GenerateRequest, { kind: "image" }>,
): AsyncIterable<AdapterEvent> {
  const params = req.params;
  const batch = Math.min(Math.max(params.batch ?? 1, 1), 4);
  const extras = (params.extras ?? {}) as Record<string, unknown>;

  // 可灵参数：n / aspect_ratio / resolution
  const parameters: Record<string, unknown> = { n: batch };
  if (typeof extras.aspect_ratio === "string" && extras.aspect_ratio) {
    parameters.aspect_ratio = extras.aspect_ratio;
  }
  if (params.size) {
    // 把"1K"/"2K"映射到 kling 的 resolution（1k/2k 小写）
    const sz = params.size.toUpperCase();
    if (sz === "1K") parameters.resolution = "1k";
    else if (sz === "2K") parameters.resolution = "2k";
  }

  // messages content：先放参考图（可灵支持图生图），再放 text
  const content: Array<Record<string, unknown>> = [];
  for (const ref of params.references ?? []) {
    if (typeof ref === "string" && ref.length > 0 && ref !== "ref:omitted") {
      content.push({ image: ref });
    }
  }
  content.push({ text: req.prompt });

  yield { type: "progress", pct: 5, message: "提交到百炼·可灵" };

  // 1) 创建任务
  const createRes = await callProxy("/api/v1/services/aigc/image-generation/generation", {
    method: "POST",
    modelId: cfg.modelId, apiKey: cfg.apiKey,
    headers: { "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content }] },
      parameters,
    }),
    signal: req.signal,
  });
  const created: KlingTaskResponse = await createRes.json();
  const taskId = created?.output?.task_id;
  if (!taskId) {
    throw new AdapterError("upstream_5xx", `可灵未返回 task_id：${created?.output?.message ?? JSON.stringify(created)}`);
  }

  // 2) 轮询
  const startedAt = Date.now();
  const expected = cfg.avgLatencyMs || 20000;
  let task: KlingTaskResponse = created;

  while (
    task.output?.task_status !== "SUCCEEDED" &&
    task.output?.task_status !== "FAILED" &&
    task.output?.task_status !== "CANCELED" &&
    task.output?.task_status !== "UNKNOWN"
  ) {
    if (req.signal?.aborted) {
      void callProxy(`/api/v1/tasks/${taskId}/cancel`, { method: "POST", modelId: cfg.modelId, apiKey: cfg.apiKey }).catch(() => {});
      throw new AdapterError("cancelled", "已取消");
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > MAX_WAIT_MS) throw new AdapterError("timeout", "可灵长时间未返回，已超时");
    yield { type: "progress", pct: Math.min(95, 5 + (elapsed / expected) * 90) };
    await sleep(POLL_INTERVAL_MS, req.signal);
    const pollRes = await callProxy(`/api/v1/tasks/${taskId}`, {
      method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
    });
    task = await pollRes.json();
  }

  if (task.output?.task_status !== "SUCCEEDED") {
    const errMsg = task.output?.message ?? task.output?.code ?? task.output?.task_status;
    throw new AdapterError(
      task.output?.task_status === "CANCELED" ? "cancelled" : "upstream_5xx",
      `可灵生成失败：${errMsg}`,
    );
  }

  // 3) 解析 choices[].message.content[].image
  const urls: string[] = [];
  for (const choice of task.output?.choices ?? []) {
    for (const item of choice.message?.content ?? []) {
      if (typeof item?.image === "string" && item.image.length > 0) urls.push(item.image);
    }
  }
  if (urls.length === 0) throw new AdapterError("upstream_5xx", "可灵未返回任何图像");

  yield { type: "progress", pct: 99 };
  yield {
    type: "final",
    kind: "image",
    imageUrls: urls,
    cost: cfg.costPerCall * batch,
  };
}
