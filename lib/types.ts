// Domain types for Lumen.
// These contracts are the seam between UI and backend — backend swap should
// only touch lib/api/* implementations, not these shapes.

export type Role = "user" | "admin";
export type AccountStatus = "pending" | "active" | "rejected" | "disabled";

export interface User {
  id: string;
  username: string;
  // never sent to UI in real backend; included here only for mock auth
  passwordHash?: string;
  role: Role;
  status: AccountStatus;
  createdAt: string; // ISO
  approvedAt?: string;
  rejectedReason?: string;
}

export type ModelKind = "image" | "video";

/**
 * Identifies which adapter handles a model. Built-in mock generators use
 * "mock"; admin-configured custom models pick a real provider.
 */
export type ProviderType =
  | "mock"
  // ── 阿里云百炼按"家族"分组（推荐）—— 一份 SecretKey 调一族所有 SKU ──
  | "bailian-tongyi"      // 通义万相 — wan2.X-t2i / t2v / i2v / r2v / videoedit + qwen-image
  | "bailian-qwen"        // 通义千问 — qwen* 文本对话 / 视觉理解
  | "bailian-thirdparty"  // 百炼托管的第三方 — kling/* · vidu/* · pixverse/* · MiniMax/* 等
  | "openai-image"
  | "stability-image"
  | "replicate-image"
  | "replicate-video"
  | "dashscope-image"   // 已弃用（保留以兼容旧配置）：用 bailian-tongyi
  | "dashscope-video"   // 已弃用（保留以兼容旧配置）：用 bailian-tongyi
  | "minimax-video"     // MiniMax 海螺视频（独立平台 api.minimax.io）
  | "jimeng-image"      // 即梦 3.x/4.0（火山智能视觉·V4 签名）
  | "jimeng-video"      // 即梦 3.0 视频（火山智能视觉·V4 签名 + 异步）
  | "ark-image"         // 火山方舟·豆包 Seedream（Bearer Auth，OpenAI 兼容）
  | "ark-video"         // 火山方舟·豆包 Seedance（Bearer Auth + 异步任务）
  | "comfyui-local"
  | "generic-http";

/**
 * Variation / edit operations a given image model can perform on top of a
 * generated image. Used by the canvas image-node toolbar to decide which
 * action buttons to render — buttons for capabilities the model lacks are
 * hidden, not just disabled.
 */
export type ImageCapability =
  | "upscale"      // 高清放大
  | "multiAngle"   // 多视角
  | "relight"      // 重打光
  | "grid9"        // 九宫格 / 多变体
  | "outpaint"     // 拓展画面
  | "stylize"      // 风格化
  | "inpaint";     // 涂抹编辑

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  kind: ModelKind;
  description: string;
  costPerCall: number; // mock credit
  // average mock latency ms — used to drive progress UI
  avgLatencyMs: number;
  // failure rate baked into mock for analytics realism (0..1)
  baseFailureRate: number;
  badge?: "new" | "fast" | "premium";
  /** Image-only — what variation operations this model supports. */
  capabilities?: ImageCapability[];
  /** True when admin-added (vs hard-coded BUILT_IN). */
  isCustom?: boolean;
  /** Admin can disable a custom model without deleting it. Default true. */
  enabled?: boolean;
  /**
   * Which adapter to use. Defaults to "mock" if absent (back-compat).
   * Built-in models are explicitly tagged "mock" in catalog.ts.
   */
  providerType?: ProviderType;
  /** Admin-supplied upstream connection (visible in admin only). */
  endpoint?: string;
  /**
   * Stage-2: API Key 已迁移到服务端 SQLite (lumen.db) + AES-GCM 加密存储。
   * 客户端永远拿不到明文 —— 该字段在 client-side ModelInfo 上**不再返回**。
   * 仅保留这个字段名是为了兼容旧的草稿态 / 测试连接路径（客户端临时填的 Key）。
   * 正常运行时 client adapter 通过 X-Lumen-Model-Id 头让服务端反查解密。
   */
  apiKey?: string;
  /** Stage-2: 服务端是否已为该 model 设置过 apiKey。供 admin UI 显示状态。 */
  hasApiKey?: boolean;
  providerModelId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type PromptMode = "idea" | "script";

/**
 * A reusable named entity (character, scene, prop) that the user can
 * reference in prompts via @-mention. Persisted per-user.
 */
export interface Subject {
  id: string;
  userId: string;
  name: string;            // unique-per-user; the @ handle
  description: string;     // free-form descriptor used to expand the prompt
  imageUrl?: string;       // reference still
  tags: string[];          // freeform labels (角色 / 场景 / 物品 / IP …)
  createdAt: string;
  updatedAt: string;
}

export interface ImageParams {
  /**
   * Free-form size string. Default UI options are the 11 listed in
   * DEFAULT_IMAGE_SPEC; per-model spec narrows or replaces this set
   * (e.g. OpenAI dall-e-3 only allows 3; Replicate Flux uses aspect
   * ratios like "16:9" instead). Adapter is responsible for whatever
   * mapping the upstream API needs.
   */
  size: string;
  batch: number;
  style: string;
  negativePrompt?: string;
  seed?: number;
  /** "idea" → short prompt, "script" → multi-paragraph storyboard */
  mode?: PromptMode;
  /** Inline reference images, base64 in mock — OSS URLs in real backend */
  references?: string[];
  /** IDs of @-mentioned subjects, resolved at submit time */
  subjectIds?: string[];
  /**
   * Per-model "advanced" parameters declared by the adapter's
   * describeImageParams().extras and rendered in a generic ExtrasPanel.
   * Adapter consumes these in generate() — usually merged straight
   * into the upstream input payload.
   */
  extras?: Record<string, unknown>;
}

/**
 * 视频参考模式 ——
 *  - "universal"   全能参考：1-9 张参考图，每张可有 hint 标注（人物/风格/场景/...）
 *  - "first-last"  首尾帧：refs[0] = 首帧，refs[1] = 尾帧（最多 2）
 *  - "keyframes"   智能多帧：1-9 张关键帧按顺序排列，模型在帧间补全
 */
export type VideoReferenceMode = "universal" | "first-last" | "keyframes";

export interface VideoParams {
  duration: number;
  resolution: string;
  camera: string;
  /** @deprecated 用 references[0] 替代；保留以兼容旧 doc */
  referenceImageUrl?: string;
  /** @deprecated first-last 模式下用 references[1] 替代 */
  endFrameUrl?: string;
  /** 多张参考图（≤ 9）。data: URI 或 https URL */
  references?: string[];
  /** 与 references 等长，每张图的角色提示（"人物" "风格" "场景"…） */
  referenceHints?: string[];
  /** 参考模式 — 决定 references 的语义 */
  referenceMode?: VideoReferenceMode;
  /** @-mentioned 主体 id（在 prompt 里以 @名字 出现），提交时由 buildFinalPrompt 展开为完整描述 */
  subjectIds?: string[];
  negativePrompt?: string;
  seed?: number;
  /** See ImageParams.extras */
  extras?: Record<string, unknown>;
}

/* ────────────── Capability Spec — declared by each adapter ────────────── */

/**
 * One "advanced" parameter on a per-model basis. Rendered generically by
 * the ExtrasPanel; the value goes into ImageParams.extras / VideoParams.extras
 * under the same `key` and is consumed by the adapter at generate time.
 */
export interface ExtraParam {
  key: string;
  label: string;
  type: "select" | "number" | "text" | "boolean";
  options?: Array<{ value: string; label: string }>;   // select 用
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  hint?: string;
}

/** Declares which image params a model accepts and how to render the form. */
export interface ImageParamSpec {
  size:
    | { mode: "enum"; options: Array<{ value: string; label: string; ratio: string }>; default: string }
    | { mode: "free"; default: string };
  /** 1 = batch picker hidden (model only does single-image). */
  maxBatch: number;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsReferenceImages: boolean;
  /** Cap the number of reference images this model accepts; default unlimited (UI shows up to 9). */
  maxReferenceImages?: number;
  extras?: ExtraParam[];
}

/** Declares which video params a model accepts. */
export interface VideoParamSpec {
  duration:
    | { mode: "enum"; options: number[]; default: number; hint?: string }
    | { mode: "range"; min: number; max: number; step: number; default: number; hint?: string }
    | "fixed";
  resolution:
    | { mode: "enum"; options: Array<{ value: string; label: string }>; default: string; hint?: string }
    | "fixed";
  camera:
    | { mode: "enum"; options: Array<{ value: string; label: string }>; default?: string; hint?: string }
    | { mode: "free-text"; placeholder: string; hint?: string }
    | "none";
  /** image-to-video mode (first-frame from a still). */
  supportsReferenceImage: boolean;
  /** When true, submit is disabled until a reference image is attached. */
  requiresReferenceImage?: boolean;
  /** Last-frame keyframe (e.g. Luma keyframes, Kling 首尾帧). */
  supportsEndFrame: boolean;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  extras?: ExtraParam[];
}

/**
 * A "session" groups multiple Generations into a single conversation
 * thread. Created lazily when the user submits the first generation in a
 * fresh conversation. Listed in the sidebar as "历史创作"; clicking one
 * loads its stream into the workspace.
 */
export interface Session {
  id: string;
  userId: string;
  kind: ModelKind;
  /** Auto-derived from the first generation's prompt, but editable. */
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Generation {
  id: string;
  userId: string;
  /** When omitted (legacy data), behaves as a one-off generation. */
  sessionId?: string;
  kind: ModelKind;
  modelId: string;
  prompt: string;
  status: GenerationStatus;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  cost?: number;
  errorMessage?: string;
  favorite?: boolean;
  // For image: array of image URLs. For video: single video URL (+ poster).
  imageUrls?: string[];
  videoUrl?: string;
  videoPosterUrl?: string;
  imageParams?: ImageParams;
  videoParams?: VideoParams;
}

export interface RegistrationApplication {
  id: string;
  username: string;
  passwordHash: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string;
  reviewedBy?: string;
  rejectedReason?: string;
}

export interface AdminMetrics {
  totals: {
    callsToday: number;
    callsThisWeek: number;
    callsThisMonth: number;
    creditsConsumedTotal: number;
    activeUsers: number;
    pendingApprovals: number;
    failureRate: number;
    avgLatencyMs: number;
  };
  perUser: Array<{
    userId: string;
    username: string;
    calls: number;
    credits: number;
    lastActiveAt: string;
  }>;
  modelShare: Array<{ modelId: string; modelName: string; calls: number; share: number }>;
  trend: {
    daily: TrendPoint[];
    weekly: TrendPoint[];
    monthly: TrendPoint[];
  };
  failures: {
    rate: number;
    series: TrendPoint[];
  };
  latency: {
    avgMs: number;
    p95Ms: number;
    series: TrendPoint[];
  };
}

export interface TrendPoint {
  /** ISO date or label */
  label: string;
  calls: number;
  credits: number;
  failures: number;
  avgLatencyMs: number;
}

/* ─────────────────── Canvas (node graph) ─────────────────── */

export type CanvasNodeKind =
  | "image" | "video" | "text" | "upload"
  | "director-stage"
  // freeform-only node types
  | "media-video";
export type CanvasNodeStatus = "idle" | "running" | "succeeded" | "failed";

/**
 * Two flavors of canvas:
 *   - "flow": node-graph editor with connections, generation pipeline (existing)
 *   - "freeform": free-placement moodboard — upload / paste / drag images and
 *     videos onto an infinite canvas, no edges, no generation
 */
export type CanvasKind = "flow" | "freeform";

/**
 * Canvas node data. The `[key: string]: unknown` index signature is needed
 * because @xyflow/react constrains node `data` to `Record<string, unknown>`.
 * Concrete fields below are still type-checked at use sites.
 */
export interface CanvasNodeData extends Record<string, unknown> {
  kind: CanvasNodeKind;
  prompt: string;
  modelId: string;
  status: CanvasNodeStatus;
  /** 0..100 while running */
  progress?: number;
  /** Image: array of result URLs. Video: poster URL. */
  imageUrls?: string[];
  videoPosterUrl?: string;
  videoUrl?: string;
  errorMessage?: string;
  /** Generation id once it starts (so deletion / retry can address it) */
  generationId?: string;
  /** Per-kind params */
  imageParams?: Partial<ImageParams>;
  videoParams?: Partial<VideoParams>;
  /** director-stage 节点专用：关联的 DirectorStageDoc id */
  directorStageId?: string;
}

/* ─────────────────── Director Stage（3D 构图） ─────────────────── */

export interface DirectorCamera {
  id: string;
  name: string;
  pos: [number, number, number];
  /** "manual" = 用 lookAt 坐标；其它 = 锁定到该 character id */
  lookAtMode: "manual" | string;
  lookAt: [number, number, number];
  fov: number;
  /** 在 3D 场景里隐藏机位 gizmo（相机功能仍正常，预览窗仍能用） */
  hidden?: boolean;
}

/**
 * 简化骨骼姿势 —— 所有角度都用弧度（rad），0 = 默认站立。
 * 设计上不追求生物力学准确，只为"看得懂大致姿态"。
 */
export interface DirectorCharacterPose {
  // 身体（整体根部）
  bodyTilt: number;     // 前倾（X）
  bodyTwist: number;    // 转身（Y）
  bodyLean: number;     // 侧倾（Z）
  // 躯干（腰部以上）
  torsoTilt: number;
  torsoTwist: number;
  torsoLean: number;
  // 头部
  headPitch: number;    // 点头（X）
  headYaw: number;      // 转头（Y）
  headRoll: number;     // 歪头（Z）
  // 肩膀（左右）
  shoulderL: { forward: number; out: number; twist: number };
  shoulderR: { forward: number; out: number; twist: number };
  // 肘弯曲
  elbowL: number;
  elbowR: number;
  // 髋（左右）
  hipL: { forward: number; out: number; twist: number };
  hipR: { forward: number; out: number; twist: number };
  // 膝弯曲
  kneeL: number;
  kneeR: number;
}

export interface DirectorCharacter {
  id: string;
  name: string;
  pos: [number, number, number];
  /** Y 轴旋转角度（弧度） */
  rotY: number;
  /** 0.5..2 */
  scale: number;
  /** 体型预设：standard / female / child / heavy / slim */
  build?: "standard" | "female" | "child" | "heavy" | "slim";
  /** 主色（hex 或 css 色），影响人形材质着色 */
  color?: string;
  /** 骨骼姿势（不存即默认站立） */
  pose?: DirectorCharacterPose;
  /** 是否在 3D 场景里隐藏（仍保留在大纲里） */
  hidden?: boolean;
  /** 锁定 = 不可选中、不可拖动；属性可读不可改 */
  locked?: boolean;
}

/**
 * 道具：场景里的非角色物体（家具 / 树 / 车 / 标记）。
 * 用简单几何拼出 —— 后续接 GLB 模型时只需扩展 mesh 渲染逻辑，不动数据结构。
 */
export type DirectorPropKind =
  | "chair" | "table-square" | "table-round" | "sofa"
  | "wall-2m" | "wall-3m" | "column" | "stairs"
  | "tree-small" | "tree-large" | "rock" | "bush"
  | "car" | "bike" | "lamp" | "bench"
  | "trash-bin" | "arrow" | "marker";

export interface DirectorProp {
  id: string;
  kind: DirectorPropKind;
  name: string;
  pos: [number, number, number];
  rotY: number;
  scale: number;
  hidden?: boolean;
  locked?: boolean;
}

export type DirectorAspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1" | "21:9";

export interface DirectorStageDoc {
  id: string;
  userId: string;
  /** 关联的画布节点 id，方便从导演台返回时定位 */
  canvasNodeId?: string;
  title: string;
  cameras: DirectorCamera[];
  characters: DirectorCharacter[];
  props?: DirectorProp[];
  /** 当前选中的相机 id（用于右下角预览） */
  activeCameraId?: string;
  /** 输出画面比例 —— 影响右下预览 + 确认构图截图比例。默认 16:9 */
  aspectRatio?: DirectorAspectRatio;
  /** 视图（编辑器自由相机）参数 */
  viewer?: { posTheta: number; posPhi: number; distance: number; targetX: number; targetY: number; targetZ: number };
  /** 最近一次构图的截图 dataURL，回到画布节点上做预览 */
  thumbnailDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasNode {
  id: string;
  type: CanvasNodeKind;   // matches xyflow's nodeType key
  position: { x: number; y: number };
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDoc {
  id: string;
  userId: string;
  /** Editor flavor — flow (node-graph) or freeform (moodboard) */
  kind: CanvasKind;
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  /** Cover thumbnail (data URL of the most recent successful node's first image) */
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/* ─────────────── 媒体处理（腾讯云 MPS） ─────────────── */

/**
 * 腾讯云 MPS 鉴权配置（管理员后台填）。
 * SecretId / SecretKey 来自 console.cloud.tencent.com/cam/capi
 * Region 通常 ap-shanghai / ap-guangzhou / ap-beijing
 */
export interface MediaProcessingConfig {
  secretId: string;
  secretKey: string;
  region: string;
  /** 关联的 COS 桶（输入/输出文件） —— 大多数 MPS 任务需要文件落在 COS */
  cosBucket?: string;
  cosRegion?: string;
  enabled: boolean;
  updatedAt: string;
}

/**
 * 用户在工具页发起的媒体处理任务记录。
 * 兜底"任务-状态"列表，跨工具复用。
 */
export type MediaProcessingToolId =
  | "custom-task"     // 创建自定义任务（直接调腾讯云 ProcessMedia / ProcessLiveStream 等）
  | "transcode-fast"  // 极速高清转码
  | "audio-enhance"   // 音视频增强
  | "smart-erase"     // 智能擦除-去字幕
  | "smart-subtitle"  // 智能字幕
  // 注：腾讯云 MPS AI 配音已下线（参考音色 JSON Schema 内测限制 + 流程冗长）。
  // 工作台改用 /app/voice 的 CosyVoice 2，更直接。
  | "smart-clip"      // 智能拆条
  | "highlights"      // 精彩集锦
  | "watermark"       // 添加数字水印
  | "media-qc"        // 媒体质检
  | "screenshot";     // 截图、转动图

export type MediaProcessingTaskStatus =
  | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface MediaProcessingTask {
  id: string;
  userId: string;
  toolId: MediaProcessingToolId;
  inputUrl: string;
  /** 工具特定的输入参数（JSON 化存） */
  params: Record<string, unknown>;
  status: MediaProcessingTaskStatus;
  /** 0..100 */
  progress?: number;
  /** 腾讯云返回的 TaskId（成功创建后） */
  upstreamTaskId?: string;
  /** 输出 URL 列表 */
  outputUrls?: string[];
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}
