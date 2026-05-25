"use client";

import * as React from "react";
import {
  AlertTriangle, ChevronRight, Clapperboard, ExternalLink, Eye, EyeOff,
  ImageIcon, Loader2, Lock, Plus, Settings2, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as adminModelsApi from "@/lib/api/admin-models";
import { useCatalogStore } from "@/lib/store/catalog-store";
import { LumenApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ImageCapability, ModelInfo, ModelKind, ProviderType } from "@/lib/types";
import { hasRealAdapter } from "@/lib/providers/registry";
import { isReadyForUse } from "@/lib/catalog";

/* ============================================================
 * 「模型供应商」配置页（v2 · 家族优先布局）
 *
 * 设计哲学：以"家族"为单位组织（即梦 = 图+视频；豆包 = Seedream+Seedance；
 * 通义万相 = 图+视频+r2v+编辑），UI 不再按 image/video 分开。一份 API Key
 * 跑一族 SKU。改凭证时跨该家族下所有 ProviderType 批量同步。
 *
 * 数据层不变：底层仍是平铺的 customModels[ModelInfo]。每个 ModelInfo 仍挂
 * 一个 ProviderType（如 jimeng-image / jimeng-video），UI 把它们聚合到
 * "即梦"家族下显示，凭证共享，创建时根据 SKU 的 kind 自动选对应 type。
 *
 * 旧版 UI 已备份到 backup/admin-models-page.legacy.tsx，回滚命令：
 *   cp backup/admin-models-page.legacy.tsx app/admin/models/page.tsx
 * ============================================================ */

/* ───────────────── 数据：家族定义 ───────────────── */

interface FamilyMember {
  /** 该 kind 的 SKU 走哪个 ProviderType（adapter 路由依据） */
  type: ProviderType;
  kind: ModelKind;
}

interface ProviderFamily {
  /** 家族 id，仅用于 UI 状态 / MODEL_ID_PRESETS 索引；不必等于任何 ProviderType */
  id: string;
  label: string;
  vendor: string;
  hint: string;
  signupUrl?: string;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
  /** 该家族下属的（ProviderType, kind）成员，可一对多 */
  members: FamilyMember[];
  /** 已废弃：左栏只在已有数据时显示 */
  deprecated?: boolean;
}

const FAMILIES: ProviderFamily[] = [
  // ── 阿里云百炼三族（推荐主力）──
  { id: "bailian-tongyi", label: "通义万相（图 + 视频）", vendor: "阿里云百炼",
    hint: "一份 API Key 跑通义万相全家：t2i 文生图 / t2v 文生视频 / i2v 图生视频 / r2v 多主体参考 / videoedit 视频编辑。选择 model_id 后系统自动判定 image / video。",
    signupUrl: "https://bailian.console.aliyun.com/",
    apiKeyLabel: "百炼 API Key", apiKeyPlaceholder: "sk-...",
    members: [
      { type: "bailian-tongyi", kind: "image" },
      { type: "bailian-tongyi", kind: "video" },
    ],
  },
  { id: "bailian-qwen", label: "通义千问（图像）", vendor: "阿里云百炼",
    hint: "Qwen 自家图像生成（qwen-image-2.0-pro 等），与万相共用同一份百炼 API Key。",
    signupUrl: "https://bailian.console.aliyun.com/",
    apiKeyLabel: "百炼 API Key", apiKeyPlaceholder: "sk-...",
    members: [{ type: "bailian-qwen", kind: "image" }],
  },
  { id: "bailian-thirdparty", label: "百炼托管第三方（Kling / Vidu / PixVerse）",
    vendor: "阿里云百炼",
    hint: "可灵 / 生数 Vidu / 爱诗 PixVerse 都通过百炼网关调用，共用同一份百炼 sk-... Key。需在百炼控制台单独开通对应模型授权。",
    signupUrl: "https://bailian.console.aliyun.com/",
    apiKeyLabel: "百炼 API Key", apiKeyPlaceholder: "sk-...",
    members: [
      { type: "bailian-thirdparty", kind: "image" },
      { type: "bailian-thirdparty", kind: "video" },
    ],
  },

  // ── 其它平台 ──
  { id: "openai", label: "OpenAI 图像", vendor: "OpenAI",
    hint: "OpenAI 官方图像 API（gpt-image-1 / DALL·E 3）。中国大陆需自备代理。",
    signupUrl: "https://platform.openai.com/api-keys",
    apiKeyLabel: "OpenAI API Key", apiKeyPlaceholder: "sk-...",
    members: [{ type: "openai-image", kind: "image" }],
  },
  { id: "replicate", label: "Replicate 图像", vendor: "Replicate",
    hint: "Replicate 模型聚合平台（Flux / SDXL 等）。Model ID 用 owner/name[:version] 形式。",
    signupUrl: "https://replicate.com/account/api-tokens",
    apiKeyLabel: "Replicate Token", apiKeyPlaceholder: "r8_...",
    members: [{ type: "replicate-image", kind: "image" }],
  },
  { id: "minimax", label: "MiniMax 海螺视频", vendor: "MiniMax",
    hint: "MiniMax 海螺文生 / 图生视频（Hailuo 系列），api.minimax.io 独立平台。",
    signupUrl: "https://platform.minimax.io",
    apiKeyLabel: "MiniMax API Key", apiKeyPlaceholder: "eyJh...",
    members: [{ type: "minimax-video", kind: "video" }],
  },

  // ── 即梦合并（图 + 视频）──
  { id: "jimeng", label: "即梦 AI（图 + 视频）", vendor: "字节·即梦",
    hint: "字节即梦图像 + 视频（火山智能视觉 V4 签名），图像与视频共用同一份 AccessKey + SecretKey。用冒号合并填入：AKLT...:tWZ...",
    signupUrl: "https://console.volcengine.com/iam/keymanage/",
    apiKeyLabel: "AccessKey:SecretKey",
    apiKeyPlaceholder: "AKLT...:tWZ...",
    members: [
      { type: "jimeng-image", kind: "image" },
      { type: "jimeng-video", kind: "video" },
    ],
  },

  // ── 豆包合并（Seedream 图 + Seedance 视频）──
  { id: "ark", label: "豆包（Seedream 图 + Seedance 视频）", vendor: "字节·豆包",
    hint: "火山方舟豆包系列：Seedream 图像 + Seedance 视频，共用同一份 ARK_API_KEY。OpenAI 兼容的 Bearer Auth。",
    signupUrl: "https://console.volcengine.com/ark",
    apiKeyLabel: "ARK API Key", apiKeyPlaceholder: "...",
    members: [
      { type: "ark-image", kind: "image" },
      { type: "ark-video", kind: "video" },
    ],
  },

  // ── 演示 ──
  { id: "mock", label: "Mock（演示）", vendor: "Mock",
    hint: "本地伪造调用 — 无需 Key，用于 demo / 离线开发。",
    members: [
      { type: "mock", kind: "image" },
      { type: "mock", kind: "video" },
    ],
  },

  // ── 已废弃（仅在已有数据时显示）──
  { id: "dashscope-image", label: "[已废弃] 通义万相图像", vendor: "阿里云百炼",
    hint: "新建请用「通义万相（图 + 视频）」。仅保留以兼容老配置。",
    apiKeyLabel: "百炼 API Key", apiKeyPlaceholder: "sk-...",
    deprecated: true,
    members: [{ type: "dashscope-image", kind: "image" }],
  },
  { id: "dashscope-video", label: "[已废弃] 通义万相视频", vendor: "阿里云百炼",
    hint: "新建请用「通义万相（图 + 视频）」。仅保留以兼容老配置。",
    apiKeyLabel: "百炼 API Key", apiKeyPlaceholder: "sk-...",
    deprecated: true,
    members: [{ type: "dashscope-video", kind: "video" }],
  },
];

/* ── 派生工具 ── */

function familyKinds(f: ProviderFamily): ModelKind[] {
  const set = new Set<ModelKind>();
  for (const m of f.members) set.add(m.kind);
  return Array.from(set);
}
function familyTypes(f: ProviderFamily): ProviderType[] {
  return Array.from(new Set(f.members.map((m) => m.type)));
}
function familyTypeFor(f: ProviderFamily, kind: ModelKind): ProviderType {
  return f.members.find((m) => m.kind === kind)?.type ?? f.members[0].type;
}

/* ───────────────── 数据：SKU 预设（按 family.id 索引）───────────────── */

interface SkuPreset {
  value: string;
  label?: string;
  recommended?: boolean;
  /** 必填：决定走 family 中哪个 ProviderType */
  kind: ModelKind;
}

const MODEL_ID_PRESETS: Record<string, SkuPreset[]> = {
  "bailian-tongyi": [
    { value: "wan2.6-t2i", label: "wan2.6-t2i — 万相 2.6 · 像素+比例自由 ⭐", recommended: true, kind: "image" },
    { value: "wan2.5-t2i-preview", label: "wan2.5-t2i-preview — 高分辨率（768×2700 等）", kind: "image" },
    { value: "wan2.2-t2i-flash", label: "wan2.2-t2i-flash — 极速版（提速 50%）", kind: "image" },
    { value: "wan2.2-t2i-plus", label: "wan2.2-t2i-plus — 专业版", kind: "image" },
    { value: "wan2.7-t2v-2026-04-25", label: "wan2.7-t2v · 2026-04-25 — 720P/1080P · 原生音频 ⭐", recommended: true, kind: "video" },
    { value: "wan2.6-t2v", label: "wan2.6-t2v — 万相 2.6 · 多镜头", kind: "video" },
    { value: "wan2.7-i2v-2026-04-25", label: "wan2.7-i2v · 2026-04-25 — 图生视频 · 首尾帧", kind: "video" },
    { value: "wan2.6-i2v-flash", label: "wan2.6-i2v-flash — 图生视频 · 快速", kind: "video" },
    { value: "wan2.6-i2v", label: "wan2.6-i2v — 图生视频 · 标准", kind: "video" },
    { value: "wan2.7-r2v", label: "wan2.7-r2v — 参考生视频 · 多主体 + 音色 ⭐", recommended: true, kind: "video" },
    { value: "wan2.7-videoedit", label: "wan2.7-videoedit — 视频编辑 · 指令式", kind: "video" },
    { value: "wanx2.1-t2i-plus",  label: "wanx2.1-t2i-plus — 万相 2.1 专业（旧）", kind: "image" },
    { value: "wanx2.1-t2i-turbo", label: "wanx2.1-t2i-turbo — 万相 2.1 极速（旧）", kind: "image" },
    { value: "wanx2.1-i2v-turbo", label: "wanx2.1-i2v-turbo — 图生视频（旧）", kind: "video" },
  ],
  "bailian-qwen": [
    // ── 文生图 + 编辑融合（最新 2.0 系列，仅同步接口）──
    { value: "qwen-image-2.0-pro-2026-04-22", label: "qwen-image-2.0-pro · 2026-04-22 — Qwen 图像旗舰 ⭐", recommended: true, kind: "image" },
    { value: "qwen-image-2.0-pro",            label: "qwen-image-2.0-pro — 自动滚动到最新 pro 快照", kind: "image" },
    { value: "qwen-image-2.0-pro-2026-03-03", label: "qwen-image-2.0-pro · 2026-03-03 — 上代 pro", kind: "image" },
    { value: "qwen-image-2.0",                label: "qwen-image-2.0 — 加速版（兼顾速度与质量）", kind: "image" },
    { value: "qwen-image-2.0-2026-03-03",     label: "qwen-image-2.0 · 2026-03-03 — 上代加速版", kind: "image" },
    // ── 文生图专用（异步接口） ──
    { value: "qwen-image-max",                label: "qwen-image-max — Max 档 · 真实感最强", kind: "image" },
    { value: "qwen-image-max-2025-12-30",     label: "qwen-image-max · 2025-12-30 — Max 快照", kind: "image" },
    { value: "qwen-image-plus",               label: "qwen-image-plus — Plus 档 · 多艺术风格 + 文字渲染", kind: "image" },
    { value: "qwen-image-plus-2026-01-09",    label: "qwen-image-plus · 2026-01-09 — Plus 快照（max 蒸馏加速）", kind: "image" },
    { value: "qwen-image",                    label: "qwen-image — 基础文生图", kind: "image" },
    // ── 图像编辑专用 ──
    { value: "qwen-image-edit",               label: "qwen-image-edit — 图生图 / 局部修改", kind: "image" },
  ],
  "bailian-thirdparty": [
    { value: "kling/kling-v3-image-generation",      label: "Kling v3 Image — 可灵图像", kind: "image" },
    { value: "kling/kling-v3-omni-image-generation", label: "Kling v3 Omni Image — 多模态图像", kind: "image" },
    { value: "kling/kling-v3-video-generation",      label: "Kling v3 Video — 可灵视频 ⭐", recommended: true, kind: "video" },
    { value: "kling/kling-v3-omni-video-generation", label: "Kling v3 Omni Video — 五合一", kind: "video" },
    { value: "vidu/viduq3-pro_text2video",           label: "Vidu Q3 Pro · text2video", kind: "video" },
    { value: "vidu/viduq3-pro_img2video",            label: "Vidu Q3 Pro · img2video", kind: "video" },
    { value: "vidu/viduq3-turbo_text2video",         label: "Vidu Q3 Turbo · text2video", kind: "video" },
    { value: "pixverse/pixverse-c1-t2v",             label: "PixVerse C1 — 文生视频", kind: "video" },
    { value: "pixverse/pixverse-c1-it2v",            label: "PixVerse C1 — 图生视频", kind: "video" },
  ],
  "openai": [
    { value: "gpt-image-1", label: "gpt-image-1 ⭐", recommended: true, kind: "image" },
    { value: "dall-e-3", kind: "image" },
  ],
  "replicate": [
    { value: "black-forest-labs/flux-1.1-pro", label: "Flux 1.1 Pro ⭐", recommended: true, kind: "image" },
    { value: "black-forest-labs/flux-pro", kind: "image" },
    { value: "black-forest-labs/flux-schnell", kind: "image" },
    { value: "stability-ai/sdxl", kind: "image" },
  ],
  "minimax": [
    { value: "MiniMax-Hailuo-2.3",      label: "MiniMax-Hailuo-2.3 — 文生视频 · 旗舰 ⭐", recommended: true, kind: "video" },
    { value: "MiniMax-Hailuo-2.3-Fast", label: "Hailuo-2.3-Fast — 图生视频 · 快速", kind: "video" },
    { value: "MiniMax-Hailuo-02",       label: "MiniMax-Hailuo-02 — 上一代", kind: "video" },
    { value: "T2V-01-Director",         label: "T2V-01-Director — 运镜指令", kind: "video" },
    { value: "T2V-01",                  label: "T2V-01 — 通用文生视频", kind: "video" },
  ],
  "jimeng": [
    // 图像
    { value: "jimeng_t2i_v40", label: "即梦 4.0 · 文生图 ⭐", recommended: true, kind: "image" },
    { value: "jimeng_t2i_v31", label: "即梦 3.1 · 文生图", kind: "image" },
    { value: "jimeng_t2i_v30", label: "即梦 3.0 · 文生图", kind: "image" },
    // 视频
    { value: "jimeng_vgfm_t2v_l20", label: "即梦视频 · 文生视频 720P ⭐", recommended: true, kind: "video" },
    { value: "jimeng_vgfm_i2v_l20", label: "即梦视频 · 图生视频 720P · 需首帧", kind: "video" },
  ],
  "ark": [
    // 图像
    { value: "doubao-seedream-5-0", label: "Seedream 5.0 · 旗舰 ⭐", recommended: true, kind: "image" },
    { value: "doubao-seedream-5-0-lite", label: "Seedream 5.0 · Lite", kind: "image" },
    { value: "doubao-seedream-4-5", kind: "image" },
    { value: "doubao-seedream-4-0", kind: "image" },
    // 视频
    { value: "doubao-seedance-2-0-260128",      label: "Seedance 2.0 · 旗舰（2K + 唇同步）⭐", recommended: true, kind: "video" },
    { value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 · 快速版", kind: "video" },
    { value: "doubao-seedance-1-0-pro-250528",  label: "Seedance 1.0 Pro · 上代", kind: "video" },
  ],
};

const ALL_CAPS: Array<{ id: ImageCapability; label: string }> = [
  { id: "upscale",    label: "高清放大" },
  { id: "multiAngle", label: "多视角" },
  { id: "relight",    label: "重打光" },
  { id: "grid9",      label: "九宫格" },
  { id: "outpaint",   label: "拓展画面" },
  { id: "stylize",    label: "风格化" },
  { id: "inpaint",    label: "涂抹编辑" },
];

function detectKindFromModelId(modelId: string): ModelKind | null {
  const id = modelId.toLowerCase();
  if (/-t2v\b|-i2v\b|-r2v\b|-videoedit\b/.test(id)) return "video";
  if (/(text2video|img2video|image2video)/.test(id)) return "video";
  if (/(^|\/)[^/]*video[^/]*$/.test(id)) return "video";
  if (/seedance/.test(id)) return "video";
  if (/-t2i\b/.test(id)) return "image";
  if (/qwen-image|^kling\/.+image|seedream/.test(id)) return "image";
  return null;
}

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "****";
  return `${k.slice(0, 3)}····${k.slice(-4)}`;
}

/* ───────────────── 主页面 ───────────────── */

export default function AdminModelsPage() {
  const customModels = useCatalogStore((s) => s.customModels);
  const reload = useCatalogStore((s) => s.reload);

  // 每个 family 的统计：聚合该 family 下所有 ProviderType 的 ModelInfo
  const stats = React.useMemo(() => {
    const map = new Map<string, { total: number; enabled: number }>();
    for (const f of FAMILIES) {
      const types = new Set(familyTypes(f));
      let total = 0;
      let enabled = 0;
      for (const m of customModels) {
        if (types.has(m.providerType ?? "mock")) {
          total += 1;
          if (m.enabled !== false) enabled += 1;
        }
      }
      map.set(f.id, { total, enabled });
    }
    return map;
  }, [customModels]);

  const initialId: string = (() => {
    const withData = FAMILIES.find((f) => (stats.get(f.id)?.total ?? 0) > 0);
    return (withData ?? FAMILIES[0]).id;
  })();
  const [selectedId, setSelectedId] = React.useState(initialId);

  const visibleFamilies = FAMILIES.filter(
    (f) => !f.deprecated || (stats.get(f.id)?.total ?? 0) > 0,
  );

  const totalEnabled = customModels.filter((m) => m.enabled !== false).length;
  const familiesWithData = FAMILIES.filter(
    (f) => (stats.get(f.id)?.total ?? 0) > 0,
  ).length;

  const selectedFamily = FAMILIES.find((f) => f.id === selectedId) ?? FAMILIES[0];
  const selectedTypes = new Set(familyTypes(selectedFamily));
  const selectedModels = customModels.filter((m) =>
    selectedTypes.has(m.providerType ?? "mock"),
  );

  return (
    <div className="mx-auto max-w-7xl p-8">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">模型供应商</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {familiesWithData} 家供应商已配置 · 启用 {totalEnabled} 个 SKU。
          一份 API Key 配一族 SKU；改 Key 时同步到该供应商下所有模型（含图像 + 视频）。
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <FamilySidebar
          families={visibleFamilies}
          selectedId={selectedId}
          onSelect={setSelectedId}
          stats={stats}
        />
        <FamilyDetail
          key={selectedId}
          family={selectedFamily}
          models={selectedModels}
          onChange={() => reload()}
        />
      </div>
    </div>
  );
}

/* ───────────────── 左栏：家族列表 ───────────────── */

function FamilySidebar({
  families, selectedId, onSelect, stats,
}: {
  families: ProviderFamily[];
  selectedId: string;
  onSelect: (id: string) => void;
  stats: Map<string, { total: number; enabled: number }>;
}) {
  return (
    <aside className="space-y-1 self-start rounded-2xl border border-border bg-card p-2">
      {families.map((f) => {
        const s = stats.get(f.id) ?? { total: 0, enabled: 0 };
        const isSelected = f.id === selectedId;
        const adapterReady = f.members.some((m) => hasRealAdapter(m.type, m.kind));
        const kinds = familyKinds(f);
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
              isSelected
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{f.label}</span>
                {!adapterReady && (
                  <span title="适配器未实现，调用会回退到 mock"
                    className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                {kinds.includes("image") && <ImageIcon className="size-2.5" />}
                {kinds.includes("video") && <Clapperboard className="size-2.5" />}
                <span>{s.total > 0 ? `${s.enabled}/${s.total} 启用` : "未配置"}</span>
              </div>
            </div>
            {f.deprecated && (
              <Badge variant="warning" className="shrink-0 text-[9px]">弃</Badge>
            )}
            {isSelected && <ChevronRight className="size-3.5 shrink-0" />}
          </button>
        );
      })}
    </aside>
  );
}

/* ───────────────── 右栏：家族详情 ───────────────── */

function FamilyDetail({
  family, models, onChange,
}: {
  family: ProviderFamily;
  models: ModelInfo[];
  onChange: () => void;
}) {
  // Stage-2: 共享凭证 = "该家族下是否至少有一条 model 已设置 Key"。客户端永远拿不到明文，
  // 用 hasApiKey 标识；endpoint 客户端可读所以照旧。
  const hasSharedKey = models.some((m) => m.hasApiKey);
  const sharedEndpoint = models.find((m) => m.endpoint)?.endpoint ?? "";

  // keyDraft 永远是"用户当前正在输入的待保存值"，保存后清空。客户端从来不预填明文（也拿不到）。
  const [keyDraft, setKeyDraft] = React.useState("");
  const [endpointDraft, setEndpointDraft] = React.useState(sharedEndpoint);
  const [showKey, setShowKey] = React.useState(false);
  const [savingKey, setSavingKey] = React.useState(false);

  const sig = `${family.id}|${models.length}|${hasSharedKey}|${sharedEndpoint}`;
  const [lastSig, setLastSig] = React.useState(sig);
  if (sig !== lastSig) {
    setLastSig(sig);
    setKeyDraft("");
    setEndpointDraft(sharedEndpoint);
  }

  const familyTypesList = React.useMemo(() => familyTypes(family), [family]);

  const onSaveCredentials = async () => {
    if (models.length === 0) {
      toast.error("此供应商下还没有任何 SKU。先启用一个 SKU 再保存凭证。");
      return;
    }
    setSavingKey(true);
    try {
      // 一次 batch 调服务端，跨家族下所有 ProviderType 批量加密 + 落盘
      const updated = await adminModelsApi.bulkUpdateCredentials(familyTypesList, {
        apiKey: keyDraft || undefined,
        endpoint: endpointDraft || undefined,
      });
      toast.success(`已加密保存到 ${updated} 个 SKU`, {
        description: keyDraft ? "新 Key 已 AES-GCM 加密落盘，浏览器永远不见明文" : undefined,
      });
      // write-only：保存后清空文本框，避免之后页面渲染又把它带回 form
      setKeyDraft("");
      onChange();
    } catch (e) {
      toast.error(e instanceof LumenApiError ? e.message : "保存失败");
    } finally {
      setSavingKey(false);
    }
  };

  const presets = MODEL_ID_PRESETS[family.id] ?? [];
  const configuredIds = new Set(
    models.map((m) => m.providerModelId).filter(Boolean) as string[],
  );
  const unconfiguredPresets = presets.filter((p) => !configuredIds.has(p.value));

  const adapterMissing = !family.members.some((m) => hasRealAdapter(m.type, m.kind));
  const kinds = familyKinds(family);

  return (
    <div className="space-y-4">
      {/* ── 头部介绍 ── */}
      <header className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl tracking-tight">{family.label}</h2>
              {family.deprecated && (
                <Badge variant="warning" className="text-[10px]">已废弃</Badge>
              )}
              {kinds.includes("image") && (
                <Badge variant="muted" className="text-[10px]">
                  <ImageIcon className="size-2.5" /> 图像
                </Badge>
              )}
              {kinds.includes("video") && (
                <Badge variant="muted" className="text-[10px]">
                  <Clapperboard className="size-2.5" /> 视频
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{family.vendor}</div>
            <p className="mt-3 text-sm text-muted-foreground">{family.hint}</p>
            {adapterMissing && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>该供应商所有适配器均未实现 — 调用会自动回退到 mock，返回演示数据。</span>
              </div>
            )}
          </div>
          {family.signupUrl && (
            <a
              href={family.signupUrl}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
            >
              申请 / 控制台
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </header>

      {/* ── 共享凭证 ── */}
      {family.id !== "mock" && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lock className="size-3.5" /> 共享凭证
            </div>
            <span className="text-[11px] text-muted-foreground">
              改动会同步到该供应商下所有 SKU（含图像 + 视频）
            </span>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">
                {family.apiKeyLabel ?? "API Key"}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <div className="mt-1 flex">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder={family.apiKeyPlaceholder ?? "粘贴密钥"}
                    className="pr-9 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={showKey ? "隐藏" : "显示"}
                  >
                    {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {hasSharedKey
                  ? "✓ 已加密存储到 lumen.db（AES-256-GCM）。客户端无法读出原文，重填即可替换。"
                  : "未配置"}
              </p>
            </div>
            <div>
              <Label className="text-xs">API Endpoint（可选）</Label>
              <Input
                value={endpointDraft}
                onChange={(e) => setEndpointDraft(e.target.value)}
                placeholder="留空 = 走默认代理路径 /api/proxy/*"
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div className="flex items-center justify-end">
              <Button
                variant="brand" size="sm"
                onClick={onSaveCredentials}
                disabled={
                  savingKey
                  || models.length === 0
                  || (keyDraft === "" && endpointDraft === sharedEndpoint)
                }
              >
                {savingKey && <Loader2 className="size-3.5 animate-spin" />}
                {models.length === 0 ? "先启用一个 SKU" : "保存凭证"}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ── SKU 列表 ── */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            模型 SKU
            <Badge variant="muted" className="text-[10px]">
              已配置 {models.length}
            </Badge>
          </div>
          <AddCustomSkuButton
            family={family}
            sharedEndpoint={sharedEndpoint}
            onAdded={onChange}
          />
        </div>

        {models.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            还没有添加任何 SKU。从下方「可一键启用」列表里挑一个开始。
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {models.map((m) => (
              <SkuRow key={m.id} model={m} onChange={onChange} />
            ))}
          </div>
        )}

        {unconfiguredPresets.length > 0 && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              可一键启用（{unconfiguredPresets.length}）
            </div>
            <div className="flex flex-wrap gap-2">
              {unconfiguredPresets.map((p) => (
                <OneClickEnableChip
                  key={p.value}
                  preset={p}
                  family={family}
                  sharedEndpoint={sharedEndpoint}
                  onAdded={onChange}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ───────────────── SKU 单行 + 高级设置 ───────────────── */

function SkuRow({ model, onChange }: { model: ModelInfo; onChange: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const enabled = model.enabled !== false;
  const isMock = (model.providerType ?? "mock") === "mock";
  const ready = isReadyForUse(model);
  // 列出缺什么 —— 提示 admin 为什么这条 SKU 没出现在工作台
  const missing: string[] = [];
  if (!isMock && !(model.hasApiKey || model.apiKey)) missing.push("API Key");
  if (!isMock && !model.providerModelId) missing.push("model_id");

  const onToggle = async () => {
    setBusy(true);
    try {
      await adminModelsApi.setEnabled(model.id, !enabled);
      toast.success(enabled ? "已停用" : "已启用");
      onChange();
    } finally { setBusy(false); }
  };
  const onDelete = async () => {
    if (!window.confirm(`删除 SKU「${model.providerModelId ?? model.name}」？此操作不可恢复。`)) return;
    setBusy(true);
    try {
      await adminModelsApi.remove(model.id);
      toast.success("已删除");
      onChange();
    } finally { setBusy(false); }
  };

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onToggle} disabled={busy} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {model.kind === "image"
              ? <ImageIcon className="size-3 shrink-0 text-brand-400" />
              : <Clapperboard className="size-3 shrink-0 text-aurora-400" />}
            <span className="truncate font-mono text-sm">
              {model.providerModelId ?? "（未填 model_id）"}
            </span>
            {model.badge && (
              <Badge variant={model.badge === "premium" ? "warning" : "brand"} className="text-[9px]">
                {model.badge}
              </Badge>
            )}
            {enabled && !ready && (
              <Badge
                variant="warning"
                className="text-[9px]"
                title={`工作台暂不可见 — 缺少 ${missing.join(" + ")}`}
              >
                <AlertTriangle className="size-2.5" /> 缺 {missing.join(" + ")}
              </Badge>
            )}
            {ready && enabled && (
              <span title="已就绪 · 用户工作台可见" className="size-1.5 rounded-full bg-emerald-500" />
            )}
          </div>
          <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
            {model.name} · {model.costPerCall} cr · {(model.avgLatencyMs / 1000).toFixed(0)}s
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setExpanded((v) => !v)} title="高级设置">
          <Settings2 className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} disabled={busy} title="删除">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {expanded && (
        <SkuAdvanced
          model={model}
          onSaved={() => { onChange(); setExpanded(false); }}
        />
      )}
    </div>
  );
}

function SkuAdvanced({ model, onSaved }: { model: ModelInfo; onSaved: () => void }) {
  const [name, setName] = React.useState(model.name);
  const [desc, setDesc] = React.useState(model.description === "（无描述）" ? "" : model.description);
  const [cost, setCost] = React.useState(model.costPerCall);
  const [latency, setLatency] = React.useState(model.avgLatencyMs);
  const [caps, setCaps] = React.useState<ImageCapability[]>(model.capabilities ?? []);
  const [busy, setBusy] = React.useState(false);

  const onSave = async () => {
    setBusy(true);
    try {
      await adminModelsApi.update(model.id, {
        name, description: desc, costPerCall: cost, avgLatencyMs: latency,
        capabilities: model.kind === "image" ? caps : undefined,
      });
      toast.success("已保存");
      onSaved();
    } catch (e) {
      toast.error(e instanceof LumenApiError ? e.message : "保存失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 grid gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">显示名</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 text-sm" />
        </div>
        <div>
          <Label className="text-xs">描述</Label>
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="mt-1 text-sm"
            placeholder="一句话说明"
          />
        </div>
        <div>
          <Label className="text-xs">单次消耗 (cr)</Label>
          <Input
            type="number" min={0} step={1}
            value={cost}
            onChange={(e) => setCost(Number(e.target.value))}
            className="mt-1 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">估算耗时 (ms)</Label>
          <Input
            type="number" min={500} step={500}
            value={latency}
            onChange={(e) => setLatency(Number(e.target.value))}
            className="mt-1 text-sm"
          />
        </div>
      </div>

      {model.kind === "image" && (
        <div>
          <Label className="text-xs">支持的变体能力</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ALL_CAPS.map((c) => {
              const on = caps.includes(c.id);
              return (
                <button
                  key={c.id} type="button"
                  onClick={() =>
                    setCaps((cur) => on ? cur.filter((x) => x !== c.id) : [...cur, c.id])
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    on
                      ? "border-brand-400/60 bg-brand-500/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="brand" size="sm" onClick={onSave} disabled={busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          保存
        </Button>
      </div>
    </div>
  );
}

/* ───────────────── 一键启用 + 自定义 ───────────────── */

function OneClickEnableChip({
  preset, family, sharedEndpoint, onAdded,
}: {
  preset: SkuPreset;
  family: ProviderFamily;
  sharedEndpoint: string;
  onAdded: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const targetType = familyTypeFor(family, preset.kind);
      // 创建时不带 apiKey —— 客户端永远拿不到明文。如果该家族下其它 SKU 已设置过 Key，
      // bulkUpdateCredentials 会让新 SKU 也共享。否则会显示"缺 API Key"，提示 admin 去填。
      await adminModelsApi.create({
        name: `${family.vendor} · ${preset.value}`,
        vendor: family.vendor,
        kind: preset.kind,
        description: preset.label ?? preset.value,
        providerType: targetType,
        providerModelId: preset.value,
        endpoint: sharedEndpoint || undefined,
        costPerCall: preset.kind === "video" ? 10 : 2,
        avgLatencyMs: preset.kind === "video" ? 60_000 : 5_000,
        enabled: true,
      });
      toast.success(`已启用 ${preset.value}`);
      onAdded();
    } catch (e) {
      toast.error(e instanceof LumenApiError ? e.message : "添加失败");
    } finally { setBusy(false); }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        preset.recommended
          ? "border-brand-400/40 bg-brand-500/5 text-foreground hover:bg-brand-500/10"
          : "border-border bg-secondary/40 text-foreground/80 hover:bg-secondary",
      )}
      title={preset.label ?? preset.value}
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
      {preset.kind === "image"
        ? <ImageIcon className="size-3 text-brand-400/70" />
        : <Clapperboard className="size-3 text-aurora-400/70" />}
      {preset.label ?? preset.value}
    </button>
  );
}

function AddCustomSkuButton({
  family, sharedEndpoint, onAdded,
}: {
  family: ProviderFamily;
  sharedEndpoint: string;
  onAdded: () => void;
}) {
  const familyKindList = familyKinds(family);
  const [open, setOpen] = React.useState(false);
  const [modelId, setModelId] = React.useState("");
  const [kind, setKind] = React.useState<ModelKind>(familyKindList[0]);
  const [busy, setBusy] = React.useState(false);

  // 输入 model_id 时自动判定 kind（仅当家族支持多 kind 时有意义）
  const [lastSeenId, setLastSeenId] = React.useState(modelId);
  if (modelId !== lastSeenId) {
    setLastSeenId(modelId);
    if (modelId && familyKindList.length > 1) {
      const detected = detectKindFromModelId(modelId);
      if (detected && familyKindList.includes(detected) && detected !== kind) {
        setKind(detected);
      }
    }
  }

  const onSubmit = async () => {
    const v = modelId.trim();
    if (!v) return;
    setBusy(true);
    try {
      const targetType = familyTypeFor(family, kind);
      await adminModelsApi.create({
        name: `${family.vendor} · ${v}`,
        vendor: family.vendor, kind,
        description: "（自定义 SKU）",
        providerType: targetType,
        providerModelId: v,
        endpoint: sharedEndpoint || undefined,
        costPerCall: kind === "video" ? 10 : 2,
        avgLatencyMs: kind === "video" ? 60_000 : 5_000,
        enabled: true,
      });
      toast.success(`已添加 ${v}`);
      setModelId("");
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof LumenApiError ? e.message : "添加失败");
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> 自定义 SKU
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        placeholder="model_id"
        className="h-8 w-44 font-mono text-xs"
        autoFocus
      />
      {familyKindList.length > 1 && (
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ModelKind)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {familyKindList.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      )}
      <Button size="sm" onClick={onSubmit} disabled={busy || !modelId.trim()}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : "添加"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setModelId(""); }}>
        取消
      </Button>
    </div>
  );
}
