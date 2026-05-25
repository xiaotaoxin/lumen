// 媒体处理工具元数据 + 按工具构造 ProcessMedia payload。
// 根据腾讯云 MPS 官方文档：
//   ProcessMedia: https://cloud.tencent.com/document/product/862/37578
//   音视频增强：用 TranscodeTaskSet + 增强模板 Definition
//   智能擦除 / 智能字幕 / 媒体质检：是 ProcessMedia 顶级字段，不是 MediaProcessTask 子任务

import type { MediaProcessingToolId } from "../types";

export type ToolFieldType = "string" | "number" | "select" | "boolean" | "template";

export interface ToolField {
  key: string;
  label: string;
  type: ToolFieldType;
  required?: boolean;
  default?: string | number | boolean;
  hint?: string;
  /** type=select 才需要 */
  options?: Array<{ value: string | number; label: string }>;
  /** type=template 时指定从哪类 MPS 模板拉列表 */
  templateKind?: import("../api/media-processing").TemplateKind;
}

export interface MediaToolMeta {
  id: MediaProcessingToolId;
  name: string;
  hint: string;
  icon: string;
  badge?: { label: string; tone: "brand" | "warning" | "success" };
  /** 走的 Action（默认 ProcessMedia） */
  action: string;
  /** 是否在 UI 上"已实现专属预设面板" */
  implemented: boolean;
  /** 该工具暴露给用户填的额外参数（在 input URL 之外） */
  fields?: ToolField[];
}

export const MEDIA_TOOLS: MediaToolMeta[] = [
  {
    id: "custom-task",
    name: "创建自定义任务",
    hint: "手填 ProcessMedia JSON，最灵活",
    icon: "⚙️",
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "extraJson",
      label: "ProcessMedia JSON 字段（合并进 payload）",
      type: "string",
      hint: "如 { \"MediaProcessTask\": { \"TranscodeTaskSet\": [{ \"Definition\": 30 }] } }",
    }],
  },
  {
    id: "transcode-fast",
    name: "极速高清转码",
    hint: "保留画质降低 50% 成本",
    icon: "⚡",
    badge: { label: "节省 50%", tone: "success" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "转码模板",
      type: "template",
      templateKind: "transcode",
      required: true,
      default: 100010,
      hint: "默认 100010 是极速高清 1080P；切下拉看你账号下所有已建的转码模板",
    }],
  },
  {
    id: "audio-enhance",
    name: "音视频增强",
    hint: "降噪 / 锐化 / 色彩 / 大模型增强",
    icon: "✨",
    badge: { label: "AI", tone: "brand" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "增强模板",
      type: "template",
      templateKind: "transcode-enhance",
      default: 327003,
      required: true,
      hint: "327003=真人场景大模型增强 1080P · 327004=4K · 你自建的 Type=Enhance 模板也会显示",
    }],
  },
  {
    id: "smart-erase",
    name: "智能擦除-去字幕",
    hint: "AI 识别擦除画面字幕 / 水印",
    icon: "🧽",
    badge: { label: "AI", tone: "brand" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "擦除模板",
      type: "template",
      templateKind: "smart-erase",
      required: true,
      hint: "下拉显示账号下所有智能擦除模板；空列表请先到 MPS 控制台创建",
    }],
  },
  {
    id: "smart-subtitle",
    name: "智能字幕",
    hint: "100+ 翻译语种 · 自动加字幕",
    icon: "💬",
    badge: { label: "100+ 语种", tone: "brand" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "字幕模板",
      type: "template",
      templateKind: "smart-subtitle",
      required: true,
      hint: "下拉显示账号下所有智能字幕模板",
    }],
  },
  // 腾讯云 MPS AI 配音已下线 —— 参考音色 JSON 必须用腾讯音色库 VoiceId（内测限制），
  // 字幕 JSON 又依赖先跑「智能字幕」，链路冗长。Lumen 工作台改用 /app/voice 的 CosyVoice 2，
  // 文本+音色直出 mp3，无需 COS 流转。
  {
    id: "smart-clip",
    name: "智能拆条",
    hint: "长视频自动拆分成短片段",
    icon: "✂️",
    badge: { label: "AI", tone: "brand" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "智能拆条模板",
      type: "template",
      templateKind: "ai-analysis",
      required: true,
      hint: "走 AiAnalysisTask · 含 SegmentConfigure 的模板",
    }],
  },
  {
    id: "highlights",
    name: "精彩集锦",
    hint: "自动剪辑高光合集",
    icon: "🎬",
    badge: { label: "AI", tone: "brand" },
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "精彩集锦模板",
      type: "template",
      templateKind: "ai-analysis",
      required: true,
      hint: "走 AiAnalysisTask · 含 HighlightConfigure 的模板",
    }],
  },
  {
    id: "watermark",
    name: "添加数字水印",
    hint: "图片 / 文字水印",
    icon: "💧",
    action: "ProcessMedia",
    implemented: true,
    fields: [
      {
        key: "transcodeDefinition",
        label: "转码模板",
        type: "template",
        templateKind: "transcode",
        default: 100010,
        required: true,
      },
      {
        key: "watermarkDefinition",
        label: "水印模板",
        type: "template",
        templateKind: "watermark",
        required: true,
        hint: "没有模板时可一键创建 Lumen 默认文字水印；或去 MPS 控制台自定义",
      },
    ],
  },
  {
    id: "media-qc",
    name: "媒体质检",
    hint: "检测画质 / 音质 / 黑屏 / 卡顿",
    icon: "🔍",
    action: "ProcessMedia",
    implemented: true,
    fields: [{
      key: "definition",
      label: "质检模板",
      type: "template",
      templateKind: "ai-qc",
      required: true,
      hint: "走 AiQualityControlTask",
    }],
  },
  {
    id: "screenshot",
    name: "截图、转动图",
    hint: "提取关键帧 / 制作 GIF",
    icon: "📸",
    action: "ProcessMedia",
    implemented: true,
    fields: [
      {
        key: "snapshotDefinition",
        label: "时间点截图模板",
        type: "template",
        templateKind: "snapshot",
        default: 10,
      },
      {
        key: "gifDefinition",
        label: "转动图模板（留空则不生成 GIF）",
        type: "template",
        templateKind: "animated",
      },
    ],
  },
];

export function findTool(id: string): MediaToolMeta | undefined {
  return MEDIA_TOOLS.find((t) => t.id === id);
}

/* ──────────────────── payload 构造 ──────────────────── */

export interface BuildPayloadOpts {
  toolId: MediaProcessingToolId;
  inputInfo: Record<string, unknown>;
  outputStorage?: Record<string, unknown>;
  outputDir?: string;
  /** 用户在表单里填的字段（key 来自 ToolField.key） */
  fieldValues: Record<string, string | number | boolean | undefined>;
}

export function buildProcessMediaPayload(opts: BuildPayloadOpts): Record<string, unknown> {
  const base: Record<string, unknown> = {
    InputInfo: opts.inputInfo,
    ...(opts.outputStorage ? { OutputStorage: opts.outputStorage } : {}),
    OutputDir: opts.outputDir ?? "/lumen-out/",
  };

  const v = opts.fieldValues;
  const num = (k: string) => {
    const x = v[k];
    return typeof x === "number" ? x : (typeof x === "string" && x ? Number(x) : undefined);
  };

  switch (opts.toolId) {
    case "transcode-fast": {
      const def = num("definition") ?? 100010;
      base.MediaProcessTask = { TranscodeTaskSet: [{ Definition: def }] };
      break;
    }
    case "audio-enhance": {
      const def = num("definition") ?? 327003;
      base.MediaProcessTask = { TranscodeTaskSet: [{ Definition: def }] };
      break;
    }
    case "smart-erase": {
      const def = num("definition");
      if (!def) throw new Error("请填写智能擦除模板 ID");
      base.SmartEraseTask = { Definition: def };
      break;
    }
    case "smart-subtitle": {
      const def = num("definition");
      if (!def) throw new Error("请填写智能字幕模板 ID");
      base.SmartSubtitlesTask = { Definition: def };
      break;
    }
    case "smart-clip":
    case "highlights": {
      const def = num("definition");
      if (!def) throw new Error("请填写模板 ID");
      base.AiAnalysisTask = { Definition: def };
      break;
    }
    case "media-qc": {
      const def = num("definition");
      if (!def) throw new Error("请填写质检模板 ID");
      base.AiQualityControlTask = { Definition: def };
      break;
    }
    case "watermark": {
      const tDef = num("transcodeDefinition") ?? 100010;
      const wDef = num("watermarkDefinition");
      if (!wDef) throw new Error("请填写水印模板 ID");
      base.MediaProcessTask = {
        TranscodeTaskSet: [{
          Definition: tDef,
          WatermarkSet: [{ Definition: wDef }],
        }],
      };
      break;
    }
    case "screenshot": {
      const sub: Record<string, unknown> = {};
      const sDef = num("snapshotDefinition") ?? 10;
      sub.SnapshotByTimeOffsetTaskSet = [{ Definition: sDef, ExtTimeOffsetSet: ["0%", "50%", "100%"] }];
      const gDef = num("gifDefinition");
      if (gDef) sub.AnimatedGraphicTaskSet = [{ Definition: gDef, StartTimeOffset: 0, EndTimeOffset: 5 }];
      base.MediaProcessTask = sub;
      break;
    }
    case "custom-task": {
      const extra = v.extraJson;
      if (typeof extra === "string" && extra.trim()) {
        try {
          Object.assign(base, JSON.parse(extra));
        } catch (e) {
          throw new Error(`extraJson 不是合法 JSON：${(e as Error).message}`);
        }
      }
      break;
    }
    default:
      throw new Error(`工具 ${opts.toolId} 暂未实现 payload 构造`);
  }
  return base;
}

/** 把 https://bucket-xxx.cos.region.myqcloud.com/path 解析成 InputInfo */
export function inputInfoFromUrl(url: string): Record<string, unknown> {
  const m = url.match(/^https?:\/\/([^.]+)\.cos\.([^.]+)\.myqcloud\.com\/(.+?)(\?|$)/);
  if (m) {
    return {
      Type: "COS",
      CosInputInfo: { Bucket: m[1], Region: m[2], Object: `/${m[3]}` },
    };
  }
  return {
    Type: "URL",
    UrlInputInfo: { Url: url },
  };
}
