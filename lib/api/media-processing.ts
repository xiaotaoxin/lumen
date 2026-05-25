// 媒体处理（腾讯云 MPS）API 层 ——
// 配置存 localStorage（管理员填一次），任务列表也存 localStorage。
// 真实任务调用走 /api/proxy/tencent-mps（服务端做 TC3-HMAC-SHA256 签名）。

import { KEYS, storage } from "../storage";
import type {
  MediaProcessingConfig,
  MediaProcessingTask,
  MediaProcessingToolId,
} from "../types";
import { fakeLatency } from "./index";
import { shortId } from "../utils";

/* ───────────────────────── 配置 ───────────────────────── */

const DEFAULT_CONFIG: MediaProcessingConfig = {
  secretId: "",
  secretKey: "",
  region: "ap-shanghai",
  cosBucket: "",
  cosRegion: "",
  enabled: false,
  updatedAt: "",
};

export function getConfigSync(): MediaProcessingConfig {
  return storage.get<MediaProcessingConfig>(KEYS.mediaProcessingConfig, DEFAULT_CONFIG);
}

export async function getConfig(): Promise<MediaProcessingConfig> {
  await fakeLatency(40, 80);
  return getConfigSync();
}

export async function saveConfig(patch: Partial<MediaProcessingConfig>): Promise<MediaProcessingConfig> {
  await fakeLatency(60, 120);
  const cur = getConfigSync();
  const merged: MediaProcessingConfig = {
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  // 落盘前 trim 所有字符串字段，避免粘贴时夹带空白被当成"密钥不存在"
  const next: MediaProcessingConfig = {
    ...merged,
    secretId: merged.secretId.trim(),
    secretKey: merged.secretKey.trim(),
    region: merged.region.trim(),
    cosBucket: merged.cosBucket?.trim(),
    cosRegion: merged.cosRegion?.trim(),
  };
  storage.set(KEYS.mediaProcessingConfig, next);
  return next;
}

/** 配置是否完整可用：API 密钥 + 输出 COS 都得有（用户工具直传依赖 COS） */
export function isConfigured(c?: MediaProcessingConfig): boolean {
  const cfg = c ?? getConfigSync();
  return cfg.enabled
    && !!cfg.secretId.trim()
    && !!cfg.secretKey.trim()
    && !!cfg.region.trim()
    && !!(cfg.cosBucket ?? "").trim()
    && !!(cfg.cosRegion ?? "").trim();
}

/* ───────────────────────── 任务列表 ───────────────────────── */

export function listTasksSync(userId: string): MediaProcessingTask[] {
  return storage
    .get<MediaProcessingTask[]>(KEYS.mediaProcessingTasks, [])
    .filter((t) => t.userId === userId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export async function listTasks(userId: string): Promise<MediaProcessingTask[]> {
  await fakeLatency(80, 150);
  return listTasksSync(userId);
}

export function createTaskSync(opts: {
  userId: string;
  toolId: MediaProcessingToolId;
  inputUrl: string;
  params: Record<string, unknown>;
}): MediaProcessingTask {
  const task: MediaProcessingTask = {
    id: shortId("mpt_"),
    userId: opts.userId,
    toolId: opts.toolId,
    inputUrl: opts.inputUrl,
    params: opts.params,
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  const list = storage.get<MediaProcessingTask[]>(KEYS.mediaProcessingTasks, []);
  list.unshift(task);
  storage.set(KEYS.mediaProcessingTasks, list);
  return task;
}

export function updateTaskSync(id: string, patch: Partial<MediaProcessingTask>): MediaProcessingTask | null {
  const list = storage.get<MediaProcessingTask[]>(KEYS.mediaProcessingTasks, []);
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], ...patch };
  storage.set(KEYS.mediaProcessingTasks, list);
  return list[idx];
}

export function removeTaskSync(id: string): void {
  const list = storage.get<MediaProcessingTask[]>(KEYS.mediaProcessingTasks, []);
  storage.set(KEYS.mediaProcessingTasks, list.filter((t) => t.id !== id));
}

/* ───────────────────────── 调用 MPS API（走 proxy）───────────────────────── */

interface MpsCallOptions {
  /** 腾讯云 Action 名称，如 ProcessMedia / DescribeTasks */
  action: string;
  /** API 版本，MPS 默认 2019-06-12 */
  version?: string;
  /** 区域，覆盖默认配置 */
  region?: string;
  /** 请求体 */
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * 查任务详情。腾讯云的 DescribeTaskDetail 返回完整的 TaskNotifyConfig + 各子任务结果。
 *
 * 注意：根据 ProcessMedia 走的是工作流（一般情况）还是直接子任务，结果可能落在
 *   - WorkflowTask（最常见，TaskType="WorkflowTask" 时）
 *   - ProcessMediaTask（直传子任务时）
 * 字段结构相同，只是包装层名字不同。所以这两个都要兼容。
 */
interface CosStorage { Bucket?: string; Region?: string }
interface OutputWithCos {
  OutputStorage?: { CosOutputStorage?: CosStorage; Type?: string };
  // 部分子任务字段名是 Storage 不是 OutputStorage
  Storage?: { CosOutputStorage?: CosStorage; Type?: string };
}
interface MediaProcessResultItem {
  Type?: string;
  TranscodeTask?: { Output?: OutputWithCos & { Path?: string } };
  SnapshotByTimeOffsetTask?: { Output?: OutputWithCos & { ImagePathSet?: Array<{ Path?: string }> } };
  SampleSnapshotTask?: { Output?: OutputWithCos & { ImagePathSet?: Array<{ Path?: string }> } };
  AnimatedGraphicTask?: { Output?: OutputWithCos & { Path?: string } };
  ImageSpriteTask?: { Output?: OutputWithCos & { ImagePath?: string; WebVttPath?: string } };
  AdaptiveDynamicStreamingTask?: { Output?: OutputWithCos & { Path?: string } };
}
interface ProcessTaskBundle {
  Status?: string;
  ErrCode?: number;
  Message?: string;
  MediaProcessResultSet?: MediaProcessResultItem[];
  AiAnalysisResultSet?: unknown[];
  AiQualityControlTaskResult?: unknown;
  SmartSubtitlesTaskResult?: Array<{ Output?: OutputWithCos & { SubtitlePath?: string; Path?: string } }> | { Output?: OutputWithCos & { SubtitlePath?: string; Path?: string } };
  SmartEraseTaskResult?: { Output?: OutputWithCos & { OutputVideoPath?: string; Path?: string } };
  Input?: Record<string, unknown>;
}
export interface DescribeTaskDetailResponse {
  TaskType?: string;
  Status?: "WAITING" | "PROCESSING" | "FINISH";
  CreateTime?: string;
  BeginProcessTime?: string;
  FinishTime?: string;
  /** 当 TaskType="WorkflowTask" 时这里有值 */
  WorkflowTask?: ProcessTaskBundle;
  /** 当走 ProcessMedia 直接子任务时这里有值 */
  ProcessMediaTask?: ProcessTaskBundle;
  RequestId?: string;
}

export async function describeTaskDetail(taskId: string): Promise<DescribeTaskDetailResponse> {
  return callMps<DescribeTaskDetailResponse>({
    action: "DescribeTaskDetail",
    payload: { TaskId: taskId },
  });
}

/* ───────────────── 模板列表（让 UI 自动填模板 ID） ───────────────── */

export type TemplateKind =
  | "transcode"
  | "transcode-enhance"  // 音视频增强用 Type=Enhance 过滤
  | "watermark"
  | "smart-erase"
  | "smart-subtitle"
  | "ai-analysis"
  | "ai-qc"
  | "snapshot"
  | "animated";

interface TemplateApiCfg {
  action: string;
  setField: string;
  queryParams?: Record<string, unknown>;
}

// 注意：腾讯云 MPS 的 action 命名风格不一致：
//   - 智能字幕用单数 Subtitle（DescribeSmartSubtitleTemplates）
//   - AI 分析用全大写（DescribeAIAnalysisTemplates）
//   - 质检不带 Ai 前缀（DescribeQualityControlTemplates）
// 别图统一，都按官方文档的实际名字。
const TEMPLATE_API_MAP: Record<TemplateKind, TemplateApiCfg> = {
  "transcode":          { action: "DescribeTranscodeTemplates",            setField: "TranscodeTemplateSet" },
  "transcode-enhance":  { action: "DescribeTranscodeTemplates",            setField: "TranscodeTemplateSet" }, // filter Type=Enhance below
  "watermark":          { action: "DescribeWatermarkTemplates",            setField: "WatermarkTemplateSet" },
  "smart-erase":        { action: "DescribeSmartEraseTemplates",           setField: "SmartEraseTemplateSet" },
  "smart-subtitle":     { action: "DescribeSmartSubtitleTemplates",        setField: "SmartSubtitleTemplateSet" },
  "ai-analysis":        { action: "DescribeAIAnalysisTemplates",           setField: "AIAnalysisTemplateSet" },
  "ai-qc":              { action: "DescribeQualityControlTemplates",       setField: "QualityControlTemplateSet" },
  "snapshot":           { action: "DescribeSnapshotByTimeOffsetTemplates", setField: "SnapshotByTimeOffsetTemplateSet" },
  "animated":           { action: "DescribeAnimatedGraphicsTemplates",     setField: "AnimatedGraphicsTemplateSet" },
};

export interface MpsTemplate {
  Definition: number;
  Name?: string;
  Comment?: string;
  Type?: string;
}

/**
 * 拉用户账号下的模板列表（最多 100 个）。每个工具自己的模板类型用 TemplateKind 区分。
 * 返回时把 Preset（系统预置）和 Custom（用户自建）都包含 —— 在 UI 里会带角标区分。
 */
export async function listTemplates(kind: TemplateKind): Promise<MpsTemplate[]> {
  // 音视频增强：腾讯云无 "List Enhance Templates" API；用 Type=Preset 在不同账号上回参不齐。
  // 直接按官方文档列出的 12 个 Definition ID 显式查询：
  //   大模型增强  真人 327001/327003/327005/327007 (720P/1080P/2K/4K)
  //   大模型增强  动漫 327002/327004/327006/327008 (720P/1080P/2K/4K)
  //   大模型修复  老片 327021/327022/327023/327024 (720P/1080P/2K/4K)
  // 见 https://cloud.tencent.com/document/product/862/118703
  if (kind === "transcode-enhance") {
    const resp = await callMps<Record<string, unknown>>({
      action: "DescribeTranscodeTemplates",
      payload: {
        Definitions: [
          327001, 327002, 327003, 327004,
          327005, 327006, 327007, 327008,
          327021, 327022, 327023, 327024,
        ],
      },
    });
    return (resp.TranscodeTemplateSet as MpsTemplate[]) ?? [];
  }

  const cfg = TEMPLATE_API_MAP[kind];
  const payload: Record<string, unknown> = { Limit: 100, ...(cfg.queryParams ?? {}) };
  const resp = await callMps<Record<string, unknown>>({
    action: cfg.action,
    payload,
  });
  return (resp[cfg.setField] as MpsTemplate[]) ?? [];
}

/**
 * 一键创建默认 "Lumen" 文字水印模板，避免用户必须先去 MPS 控制台。
 * 返回新创建模板的 Definition ID。
 *
 * 文字水印只需要在用 ProcessMedia 调用时再带 TextContent 把"水印文字"传过去即可。
 * 这里只创建样式模板（字体 / 字号 / 颜色 / 位置）。
 */
export async function createDefaultWatermarkTemplate(opts?: {
  name?: string;
  text?: string;
}): Promise<number> {
  const r = await callMps<{ Definition: number }>({
    action: "CreateWatermarkTemplate",
    payload: {
      Name: opts?.name ?? "Lumen 默认文字水印",
      Type: "text",
      CoordinateOrigin: "TopRight",
      XPos: "16px",
      YPos: "16px",
      TextTemplate: {
        FontType: "simkai.ttf",
        FontSize: "32px",
        FontColor: "0xffffff",
        FontAlpha: 0.7,
      },
    },
  });
  return r.Definition;
}

/**
 * 给一个 COS 对象 URL 签 GET 预签名 URL（默认 1 小时有效）。
 * 私有桶的对象只能通过预签名 URL 给浏览器访问。
 */
export async function signGetUrl(url: string, expiresInSec = 3600): Promise<string> {
  const cfg = getConfigSync();
  const res = await fetch("/api/cos-get-sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Lumen-API-Key": `${cfg.secretId.trim()}:${cfg.secretKey.trim()}`,
    },
    body: JSON.stringify({ url, expiresInSec }),
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `签名失败 (HTTP ${res.status})`);
  }
  const j = (await res.json()) as { signedUrl: string };
  return j.signedUrl;
}

/** 从 DescribeTaskDetail 的响应里抽出所有可下载的输出 URL */
export function extractOutputUrls(detail: DescribeTaskDetailResponse): string[] {
  const urls: string[] = [];
  const make = (bucket?: string, region?: string, path?: string) =>
    bucket && region && path ? `https://${bucket}.cos.${region}.myqcloud.com${path.startsWith("/") ? path : `/${path}`}` : null;

  // OutputStorage 和 Storage 两种字段名都看一遍
  const cosOf = (o?: { OutputStorage?: { CosOutputStorage?: CosStorage }; Storage?: { CosOutputStorage?: CosStorage } }): CosStorage | undefined =>
    o?.OutputStorage?.CosOutputStorage ?? o?.Storage?.CosOutputStorage;

  // 同时找两种顶层包装：WorkflowTask 和 ProcessMediaTask
  const buckets = [detail.WorkflowTask, detail.ProcessMediaTask].filter(Boolean) as ProcessTaskBundle[];

  for (const out of buckets) {
    for (const r of out.MediaProcessResultSet ?? []) {
      // 转码
      if (r.TranscodeTask?.Output) {
        const o = r.TranscodeTask.Output;
        const cos = cosOf(o);
        const u = make(cos?.Bucket, cos?.Region, o.Path);
        if (u) urls.push(u);
      }
      // 时间点截图（多张）
      for (const k of ["SnapshotByTimeOffsetTask", "SampleSnapshotTask"] as const) {
        const t = r[k];
        if (t?.Output) {
          const cos = cosOf(t.Output);
          for (const img of t.Output.ImagePathSet ?? []) {
            const u = make(cos?.Bucket, cos?.Region, img.Path);
            if (u) urls.push(u);
          }
        }
      }
      // 动图
      if (r.AnimatedGraphicTask?.Output) {
        const o = r.AnimatedGraphicTask.Output;
        const cos = cosOf(o);
        const u = make(cos?.Bucket, cos?.Region, o.Path);
        if (u) urls.push(u);
      }
      // 雪碧图（一张大图 + 一份 vtt 索引）
      if (r.ImageSpriteTask?.Output) {
        const o = r.ImageSpriteTask.Output;
        const cos = cosOf(o);
        const u1 = make(cos?.Bucket, cos?.Region, o.ImagePath);
        if (u1) urls.push(u1);
        const u2 = make(cos?.Bucket, cos?.Region, o.WebVttPath);
        if (u2) urls.push(u2);
      }
      // 自适应码流（HLS/DASH 主清单）
      if (r.AdaptiveDynamicStreamingTask?.Output) {
        const o = r.AdaptiveDynamicStreamingTask.Output;
        const cos = cosOf(o);
        const u = make(cos?.Bucket, cos?.Region, o.Path);
        if (u) urls.push(u);
      }
    }
    // 智能字幕（可能是数组也可能是单对象）
    const subs = out.SmartSubtitlesTaskResult;
    const subList = Array.isArray(subs) ? subs : (subs ? [subs] : []);
    for (const s of subList) {
      const o = s.Output;
      if (o) {
        const cos = cosOf(o);
        const u = make(cos?.Bucket, cos?.Region, o.SubtitlePath ?? o.Path);
        if (u) urls.push(u);
      }
    }
    // 智能擦除
    const erase = out.SmartEraseTaskResult?.Output;
    if (erase) {
      const cos = cosOf(erase);
      const u = make(cos?.Bucket, cos?.Region, erase.OutputVideoPath ?? erase.Path);
      if (u) urls.push(u);
    }
  }
  return urls;
}

export async function callMps<T = unknown>(opts: MpsCallOptions): Promise<T> {
  const cfg = getConfigSync();
  if (!isConfigured(cfg)) {
    throw new Error("尚未配置腾讯云媒体处理：请先到 /admin/media-processing 填入 SecretId / SecretKey");
  }
  // 粘贴时常带尾部空格 / 换行；腾讯云会直接 SecretIdNotFound，所以这里硬清
  const secretId = cfg.secretId.trim();
  const secretKey = cfg.secretKey.trim();
  const region = (opts.region ?? cfg.region).trim();
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Lumen-API-Key": `${secretId}:${secretKey}`,
    "X-TC-Action": opts.action,
    "X-TC-Version": opts.version ?? "2019-06-12",
    "X-TC-Region": region,
  });
  const res = await fetch("/api/proxy/tencent-mps", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.payload),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MPS 调用失败 (HTTP ${res.status}): ${text}`);
  }
  const json = (await res.json()) as { Response?: T & { Error?: { Code: string; Message: string } } };
  if (json.Response?.Error) {
    throw new Error(`${json.Response.Error.Code}: ${json.Response.Error.Message}`);
  }
  return (json.Response ?? {}) as T;
}
