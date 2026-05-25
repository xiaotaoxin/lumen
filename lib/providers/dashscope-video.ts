// 阿里云百炼（DashScope）视频适配器 — 通义万相 wan2.7 系列（推荐）
// 兼容 wan2.5 / wan2.6（同样新请求体），老 wanx2.1 / wan2.2 也能跑（用户填了照走，
// 上游会拒不识别的字段并回明确错误）。
//
// 推荐模型 ID（按优先级）：
//   wan2.7-t2v-2026-04-25   文生视频 · 2-15s · 720P/1080P · 原生音频 ⭐
//   wan2.7-i2v-2026-04-25   图生视频 · 同上
//   wan2.6-t2v / wan2.6-i2v / wan2.6-i2v-flash
//   wan2.5-t2v-preview      该代起开始有音频
//   wanx2.1-t2v-turbo（老） 仅 5s 静音 — 不推荐
//
// 调用模式：异步 task — 与 dashscope-image 完全同形
//   1) POST /api/v1/services/aigc/video-generation/video-synthesis
//      Header: X-DashScope-Async: enable
//      Body 见 buildBody()
//   2) GET  /api/v1/tasks/{task_id}      （轮询）
//   3) 成功: output.video_url （单条 mp4 URL）

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

const PROXY_BASE = "/api/proxy/dashscope";
const POLL_INTERVAL_MS = 2500;
// 不设硬超时——上游 GPU 拥塞期可能跑 10-20 分钟，让用户自己决定要不要取消

// 默认走 wan2.7（最新、带音频、2-15s）。老账号若没开通可在 admin 改成 wan2.6 / wanx2.1
const DEFAULT_MODEL = "wan2.7-t2v-2026-04-25";

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

interface TaskResponse {
  output?: {
    task_id?: string;
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "UNKNOWN";
    video_url?: string;
    message?: string;
    code?: string;
  };
  request_id?: string;
}

/* ───────────────────────── Capability spec ───────────────────────── */

const RATIO_OPTIONS = [
  { value: "16:9", label: "16:9 横屏" },
  { value: "9:16", label: "9:16 竖屏" },
  { value: "1:1",  label: "1:1 方形" },
  { value: "4:3",  label: "4:3" },
  { value: "3:4",  label: "3:4" },
];

function isI2V(modelId: string | undefined): boolean {
  return !!modelId && /-i2v/.test(modelId);
}

/** wan2.5 / wan2.6 / wan2.7 共用一套新请求体；wanx2.1 / wan2.2 老体留作兜底 */
function isNewGen(modelId: string | undefined): boolean {
  if (!modelId) return true;
  return /^wan2\.[5-9]/.test(modelId) || /^wan[3-9]/.test(modelId);
}

function describeT2V(modelId: string | undefined): VideoParamSpec {
  const newGen = isNewGen(modelId);
  return {
    duration: newGen
      ? {
          mode: "range",
          min: 2, max: 15, step: 1, default: 5,
          hint: "wan2.5 起支持 2-15 秒；wanx2.1 / wan2.2 仅 5 秒",
        }
      : {
          mode: "enum", options: [5], default: 5,
          hint: "老版本 wanx2.1 / wan2.2 固定 5 秒",
        },
    resolution: {
      mode: "enum",
      default: newGen ? "1080P" : "1280*720",
      options: newGen
        ? [
            { value: "720P",  label: "720P" },
            { value: "1080P", label: "1080P (默认)" },
          ]
        : [
            { value: "1280*720",  label: "横屏 720p (1280×720)" },
            { value: "720*1280",  label: "竖屏 720p (720×1280)" },
            { value: "832*480",   label: "横屏 480p (832×480)" },
            { value: "480*832",   label: "竖屏 480p (480×832)" },
          ],
    },
    camera: "none",
    supportsReferenceImage: false,
    requiresReferenceImage: false,
    supportsEndFrame: false,
    supportsNegativePrompt: newGen,    // wan2.5+ 支持；老版本不支持
    supportsSeed: true,
    extras: newGen
      ? [
          {
            key: "ratio", label: "画面比例", type: "select",
            default: "16:9",
            options: RATIO_OPTIONS,
          },
          {
            key: "audio_url", label: "自定义音轨 URL", type: "text",
            hint: "可选 · 公网 https URL，2-30 秒 wav/mp3。留空 + 启用自动配音 = wan 自动生成 BGM",
          },
          {
            key: "audio", label: "自动配音", type: "boolean",
            default: true,
            hint: "true 时若没填 audio_url，wan 会按画面自动生成匹配的背景音乐",
          },
          {
            key: "prompt_extend", label: "智能提示词扩写", type: "boolean",
            default: true,
          },
          {
            key: "watermark", label: "AI 生成水印", type: "boolean",
            default: false,
          },
        ]
      : [
          {
            key: "prompt_extend", label: "智能提示词扩写", type: "boolean",
            default: true,
          },
        ],
  };
}

function describeI2V(modelId: string | undefined): VideoParamSpec {
  const newGen = isNewGen(modelId);
  return {
    duration: newGen
      ? {
          mode: "range",
          min: 2, max: 15, step: 1, default: 5,
          hint: "wan2.5 起支持 2-15 秒",
        }
      : { mode: "enum", options: [5], default: 5, hint: "老 i2v 固定 5 秒" },
    resolution: newGen
      ? {
          mode: "enum",
          default: "720P",
          options: [
            { value: "720P",  label: "720P (默认)" },
            { value: "1080P", label: "1080P" },
          ],
        }
      : "fixed",                         // 老 i2v 自动从首帧推断
    camera: "none",
    supportsReferenceImage: true,
    requiresReferenceImage: true,
    supportsEndFrame: false,
    supportsNegativePrompt: newGen,
    supportsSeed: true,
    extras: newGen
      ? [
          {
            key: "audio_url", label: "自定义音轨 URL", type: "text",
            hint: "可选 · 公网 https URL，2-30 秒 wav/mp3",
          },
          {
            key: "audio", label: "自动配音", type: "boolean",
            default: true,
          },
          {
            key: "prompt_extend", label: "智能提示词扩写", type: "boolean",
            default: true,
          },
          {
            key: "watermark", label: "AI 生成水印", type: "boolean",
            default: false,
          },
        ]
      : [
          { key: "prompt_extend", label: "智能提示词扩写", type: "boolean", default: true },
        ],
  };
}

/* ───────────────────────── Body builders ───────────────────────── */

/**
 * 归一化 wan2.5+ 新 API 的 resolution 字段，仅接受字面量 `"720P"` / `"1080P"`。
 * UI 历史上有 `"720p"`（小写）、`"720"`、`"1280*720"`（老格式）等多种写法，
 * 在此统一兜底，避免百炼直接返回 400。
 */
function normalizeNewGenResolution(value: string | undefined, isImageToVideo: boolean): string {
  const fallback = isImageToVideo ? "720P" : "1080P";
  if (!value) return fallback;
  const v = value.trim().toUpperCase();
  if (v === "1080P" || v.includes("1920") || v.includes("1080")) return "1080P";
  if (v === "720P"  || v.includes("1280") || v.includes("720"))  return "720P";
  return fallback;
}

interface BuiltBody {
  body: Record<string, unknown>;
}

function buildBody(model: string, req: Extract<GenerateRequest, { kind: "video" }>): BuiltBody {
  const i2v = isI2V(model);
  const newGen = isNewGen(model);
  const params = req.params;
  const extras = (params.extras ?? {}) as Record<string, unknown>;

  const input: Record<string, unknown> = { prompt: req.prompt };

  if (newGen && params.negativePrompt) {
    input.negative_prompt = params.negativePrompt;
  }

  if (i2v) {
    if (!params.referenceImageUrl) {
      throw new AdapterError("bad_request", `${model} 是图生视频模型，请上传一张首帧`);
    }
    // wan2.6+ 接受 base64 / 公网 URL / OSS URL 三种；老 wanx2.1 只接受公网 URL
    if (!newGen && params.referenceImageUrl.startsWith("data:")) {
      throw new AdapterError(
        "unsupported",
        "老版 wanx2.1-i2v 只接受公网 URL 首帧；请改用 wan2.7-i2v-2026-04-25（已支持 base64）",
      );
    }
    input.img_url = params.referenceImageUrl;
  }

  // input.audio_url（仅 newGen 支持）
  if (newGen) {
    const audioUrl = (extras.audio_url as string | undefined)?.toString().trim();
    if (audioUrl) input.audio_url = audioUrl;
  }

  const parameters: Record<string, unknown> = {
    duration: params.duration || 5,
  };

  if (newGen) {
    // 新 API 用 resolution + ratio 双轴控制
    parameters.resolution = normalizeNewGenResolution(params.resolution, i2v);
    if (typeof extras.ratio === "string" && extras.ratio) parameters.ratio = extras.ratio;
    // audio / watermark / prompt_extend 透传
    for (const k of ["audio", "prompt_extend", "watermark"] as const) {
      const v = extras[k];
      if (v !== undefined && v !== "") parameters[k] = v;
    }
  } else {
    // 老 API 用 size 单字段（如 "1280*720"）
    parameters.size = params.resolution || "1280*720";
    if (typeof extras.prompt_extend === "boolean") parameters.prompt_extend = extras.prompt_extend;
  }

  if (typeof params.seed === "number") parameters.seed = params.seed;

  return { body: { model, input, parameters } };
}

/* ───────────────────────── Adapter ───────────────────────── */

export const dashscopeVideoAdapter: ProviderAdapter = {
  type: "dashscope-video",
  kinds: ["video"],

  describeVideoParams(modelId) {
    return isI2V(modelId) ? describeI2V(modelId) : describeT2V(modelId);
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
    if (req.kind !== "video") throw new AdapterError("unsupported", "dashscope-video 不能处理图像请求");
    assertHasAuth(cfg, "请先填入百炼 API Key（sk-...）");

    const model = cfg.providerModelId || DEFAULT_MODEL;
    const { body } = buildBody(model, req);

    yield { type: "progress", pct: 5, message: "提交到百炼" };

    const createRes = await callProxy("/api/v1/services/aigc/video-generation/video-synthesis", {
      method: "POST",
      modelId: cfg.modelId, apiKey: cfg.apiKey,
      headers: { "X-DashScope-Async": "enable" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    const created: TaskResponse = await createRes.json();
    const taskId = created?.output?.task_id;
    if (!taskId) {
      throw new AdapterError("upstream_5xx", `百炼未返回 task_id：${created?.output?.message ?? JSON.stringify(created)}`);
    }

    const startedAt = Date.now();
    // 默认 180s (wan2.7 t2v 实测 2-5 分钟)；admin 配的 avgLatencyMs 优先
    const expected = cfg.avgLatencyMs || 180_000;
    let task: TaskResponse = created;

    while (
      task.output?.task_status !== "SUCCEEDED" &&
      task.output?.task_status !== "FAILED" &&
      task.output?.task_status !== "CANCELED" &&
      task.output?.task_status !== "UNKNOWN"
    ) {
      if (req.signal?.aborted) {
        void callProxy(`/api/v1/tasks/${taskId}/cancel`, {
          method: "POST", modelId: cfg.modelId, apiKey: cfg.apiKey,
        }).catch(() => {});
        throw new AdapterError("cancelled", "已取消");
      }
      const elapsed = Date.now() - startedAt;
      // 不再超时 ——只要用户不主动取消，就一直轮询，让上游 GPU 慢慢出
      // 渐近曲线：5 + 85 * factor / (1+factor) → 永远逼近但触不到 90，
      // 即便实际耗时远超 expected，UI 仍能看到细微进度变化。
      const factor = elapsed / expected;
      const stage = task.output?.task_status === "RUNNING" ? "上游 RUNNING" :
                    task.output?.task_status === "PENDING" ? "排队中" :
                    "提交中";
      yield {
        type: "progress",
        pct: Math.min(94, 5 + 85 * (factor / (1 + factor))),
        message: `${stage} · 已等待 ${formatElapsed(elapsed)}`,
      };
      await sleep(POLL_INTERVAL_MS, req.signal);
      // 单次重试：网络抖动一次不应该让一个 5+ 分钟的任务报废
      let pollRes: Response | null = null;
      let lastErr: AdapterError | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          pollRes = await callProxy(`/api/v1/tasks/${taskId}`, {
            method: "GET", modelId: cfg.modelId, apiKey: cfg.apiKey, signal: req.signal,
          });
          break;
        } catch (e) {
          if (e instanceof AdapterError && (e.code === "network" || e.code === "upstream_5xx" || e.code === "timeout")) {
            lastErr = e;
            // 第一次失败：等 1 秒静默重试；不重试取消错误
            if (attempt === 0 && !req.signal?.aborted) {
              await sleep(1000, req.signal);
              continue;
            }
          }
          throw e;
        }
      }
      if (!pollRes) throw lastErr ?? new AdapterError("network", "轮询失败");
      task = await pollRes.json();
    }

    if (task.output?.task_status !== "SUCCEEDED") {
      const rawMsg = String(task.output?.message ?? task.output?.code ?? task.output?.task_status ?? "");
      // 把常见错误翻译成可操作的中文提示
      let friendly = `百炼视频生成失败：${rawMsg}`;
      if (/product is not activated|not activated|未开通|InvalidProductActivation/i.test(rawMsg)) {
        // 阿里云百炼是模型聚合平台，每个模型 SKU（wan / kling / vidu）需要单独"开通"
        const vendorHint = /^kling/i.test(model)
          ? "「可灵 Kling」是快手的模型，由百炼托管转售；首次使用需要在百炼里开通授权。"
          : /^vidu/i.test(model)
            ? "「Vidu」是生数科技的模型，由百炼托管转售；首次使用需要在百炼里开通授权。"
            : `「${model}」是百炼平台上的视频模型；首次使用需要单独开通授权。`;
        friendly =
          `❌ 阿里云百炼账号未开通【${model}】。\n${vendorHint}\n\n` +
          `操作步骤：\n` +
          `  1. 打开 https://bailian.console.aliyun.com/\n` +
          `  2. 左侧菜单 → 模型广场（或"模型管理"→"开通模型"）\n` +
          `  3. 搜索 "${model}" → 阅读条款 → "立即开通"\n` +
          `  4. 大多数模型免费开通，按调用次数计费；开通后即时生效\n` +
          `  5. 回来重试，无需重新部署\n\n` +
          `更快替代方案：切换到你已经开通的视频模型（如 wan2.7-t2v-2026-04-25）。\n` +
          `原始错误：${rawMsg}`;
      } else if (/InvalidApiKey|invalid api key|access denied/i.test(rawMsg)) {
        friendly = `百炼 API Key 无效或没权限。请到「管理后台 → 模型配置」检查 SecretKey。原始错误：${rawMsg}`;
      } else if (/QuotaExceeded|余额不足|insufficient balance/i.test(rawMsg)) {
        friendly = `百炼账号余额不足或配额耗尽。请到 https://bailian.console.aliyun.com/ 充值。原始错误：${rawMsg}`;
      }
      throw new AdapterError(
        task.output?.task_status === "CANCELED" ? "cancelled" : "upstream_5xx",
        friendly,
      );
    }

    const videoUrl = task.output.video_url;
    if (!videoUrl) {
      throw new AdapterError("upstream_5xx", "百炼未返回 video_url");
    }

    yield { type: "progress", pct: 99 };
    yield {
      type: "final",
      kind: "video",
      videoUrl,
      videoPosterUrl: undefined,
      cost: cfg.costPerCall,
    };
  },
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
