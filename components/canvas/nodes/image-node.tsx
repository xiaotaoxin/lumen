"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Aperture, ArrowUp, Brush, ChevronDown, Clapperboard, Dice5, Download,
  FlipHorizontal2, FocusIcon, Globe, Grid3x3, Hash, ImagePlus, Languages,
  Layers, Loader2, Lock, Maximize2, MinusSquare, Pencil, Sparkles, Sun,
  Tag, Trash2, Type, Unlock, UploadCloud, UserPlus,
} from "lucide-react";
import type { ImageCapability, ImageParams } from "@/lib/types";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { findModel, useImageModels } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type ImageNodeData = CanvasNodeData & {
  onPromptChange?: (prompt: string) => void;
  onModelChange?: (modelId: string) => void;
  onParamsChange?: (patch: Partial<NonNullable<CanvasNodeData["imageParams"]>>) => void;
  onGenerate?: () => void;
  onQuickGenerate?: (opts: {
    promptAppend?: string;
    paramsOverride?: Partial<NonNullable<CanvasNodeData["imageParams"]>>;
    persistAppend?: boolean;
  }) => void;
  onDelete?: () => void;
  onSaveAsSubject?: (name: string) => void;
  onSendToVideo?: () => void;
  onSetUploadedImage?: (url: string) => void;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function ImageNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as ImageNodeData;
  const imageModels = useImageModels();
  const model = findModel(data.modelId);
  const isRunning = data.status === "running";
  const isFailed = data.status === "failed";
  const isSucceeded = data.status === "succeeded";
  const isIdle = data.status === "idle";
  const allImages = data.imageUrls ?? [];
  const [primaryIdx, setPrimaryIdx] = React.useState(0);
  // 重生成时重置主图：用 React 19 prev-prop-during-render 模式
  const [lastImageUrls, setLastImageUrls] = React.useState(data.imageUrls);
  if (lastImageUrls !== data.imageUrls) {
    setLastImageUrls(data.imageUrls);
    setPrimaryIdx(0);
  }
  const cover = allImages[Math.min(primaryIdx, allImages.length - 1)];
  const progress = Math.round(data.progress ?? 0);
  const [editingPrompt, setEditingPrompt] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [mirrored, setMirrored] = React.useState(false);
  // Cycle 风格化 through the available styles each click
  const styleIndexRef = React.useRef(0);
  const modelPopRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!modelOpen) return;
    const onClick = (e: MouseEvent) => {
      if (modelPopRef.current && !modelPopRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [modelOpen]);

  // Idle state has two flows: pick "文生图" (write a prompt) or "上传图片"
  // (skip generation, use an uploaded image). Default to the picker; switch
  // to the writing panel after the user clicks 文生图.
  const [wantWriting, setWantWriting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // 离开 idle 状态时清掉 writing 标志（再次进入 idle 时回到 picker 而非编辑模式）
  // React 19 prev-prop-during-render 模式
  const [lastIsIdle, setLastIsIdle] = React.useState(isIdle);
  if (lastIsIdle !== isIdle) {
    setLastIsIdle(isIdle);
    if (!isIdle) setWantWriting(false);
  }

  const onPickFile = (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`图片不能大于 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      data.onSetUploadedImage?.(reader.result as string);
      toast.success("已上传，可在下方面板继续编辑提示词或重新生成");
    };
    reader.readAsDataURL(file);
  };

  // What to show outside the node card:
  //   - Idle + selected + 未选择创作方式 → ChoicePicker
  //   - Idle + selected + 已选「文生图」    → 扩展面板（无 cover）
  //   - Succeeded + selected               → 扩展面板（带 cover）+ 上方工具栏
  //   - Failed + selected                  → 扩展面板（让用户改 prompt 重试）
  const showTopToolbar = !!selected && isSucceeded && !!cover;
  const showChoicePicker = !!selected && isIdle && !wantWriting;
  const showBottomPanel =
    !!selected && !isRunning && !showChoicePicker;

  return (
    <div
      className={cn(
        "relative w-72 rounded-2xl border bg-card text-card-foreground shadow-lg transition-all",
        selected ? "border-brand-400/70 ring-2 ring-brand-400/30" : "border-border",
      )}
      style={{ overflow: "visible" }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3.5 !border-2 !border-background !bg-muted-foreground transition-transform hover:!scale-125"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 rounded-t-2xl border-b border-border bg-surface-2 px-2 py-1.5">
        <div className="relative" ref={modelPopRef}>
          <button
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            className="nodrag inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] hover:bg-secondary"
          >
            <Sparkles className="size-3 text-brand-500" />
            <span className="max-w-[120px] truncate">{model?.name ?? "选择模型"}</span>
            <ChevronDown className="size-2.5 text-muted-foreground" />
          </button>
          {modelOpen && (
            <div className="nodrag absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
              <div className="max-h-56 overflow-y-auto p-1">
                {imageModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => { data.onModelChange?.(m.id); setModelOpen(false); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      m.id === data.modelId ? "bg-secondary" : "hover:bg-secondary/60",
                    )}
                  >
                    <span className="flex size-5 items-center justify-center rounded bg-card text-foreground">
                      <Sparkles className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {(m.avgLatencyMs / 1000).toFixed(1)}s
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Badge
          variant={isFailed ? "danger" : isRunning ? "brand" : isSucceeded ? "success" : "muted"}
          className="text-[10px] py-0 px-1.5"
        >
          {isFailed ? "失败" : isRunning ? `${progress}%` : isSucceeded ? "完成" : "待生成"}
        </Badge>
        <div className="flex-1" />
        {data.onDelete && (
          <button
            type="button"
            onClick={data.onDelete}
            className="nodrag text-muted-foreground hover:text-destructive"
            aria-label="删除节点"
            title="删除节点"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Result canvas */}
      {(isRunning || isSucceeded || isFailed) && (
        <>
          <div className="relative aspect-square w-full bg-secondary">
            {cover ? (
              <img
                src={cover}
                alt={data.prompt}
                className={cn(
                  "absolute inset-0 h-full w-full object-cover transition-transform",
                  mirrored && "-scale-x-100",
                )}
              />
            ) : (
              <div className="aurora-bg absolute inset-0" />
            )}
            {isRunning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/35 text-white">
                <Loader2 className="size-6 animate-spin text-brand-400" />
                <div className="font-display text-lg">{progress}%</div>
              </div>
            )}
            {isFailed && (
              <div className="absolute inset-x-2 bottom-2 rounded-md bg-destructive/80 px-2 py-1 text-[11px] text-destructive-foreground">
                {data.errorMessage ?? "生成失败"}
              </div>
            )}
            {allImages.length > 1 && !isRunning && (
              <div className="absolute right-2 top-2 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-mono text-white">
                {primaryIdx + 1}/{allImages.length}
              </div>
            )}
          </div>
          {/* Multi-image strip — only shown when there are 2+ */}
          {allImages.length > 1 && !isRunning && (
            <div className="nodrag flex gap-1 border-b border-border bg-surface-2 p-1.5">
              {allImages.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrimaryIdx(i)}
                  className={cn(
                    "relative size-12 shrink-0 overflow-hidden rounded-md border-2 transition-colors",
                    i === primaryIdx ? "border-brand-500" : "border-transparent hover:border-border",
                  )}
                  title={`第 ${i + 1} 张`}
                >
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Body — when there's no result yet, show a slim placeholder so the
          card has presence; the real interaction lives in the floating
          panels below (ChoicePicker / ExpandedPanel). When succeeded, show
          a one-liner prompt summary. */}
      {!isRunning && !isSucceeded && !isFailed && (
        <div className="flex items-center justify-center rounded-b-2xl px-3 py-6 text-[11px] text-muted-foreground">
          {data.prompt
            ? <span className="line-clamp-1 italic">「{data.prompt}」</span>
            : "未生成 · 选中节点开始创作"}
        </div>
      )}
      {isSucceeded && (
        <div className="rounded-b-2xl px-3 py-2 text-[11px] text-muted-foreground nodrag">
          <p className="line-clamp-2 leading-snug">{data.prompt || "（无提示词）"}</p>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!size-3.5 !border-2 !border-background !bg-brand-500 transition-transform hover:!scale-125"
      />

      {/* Hidden file input — driven by the ChoicePicker's 上传图片 option */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickFile(f);
          e.target.value = "";
        }}
      />

      {/* Choice picker (idle, before user picks a creation flow) */}
      {showChoicePicker && (
        <ChoicePicker
          onPickWriting={() => setWantWriting(true)}
          onPickUpload={() => fileInputRef.current?.click()}
        />
      )}

      {/* Floating tools when the node is selected */}
      {showTopToolbar && (
        <FloatingTopToolbar
          capabilities={model?.capabilities ?? []}
          mirrored={mirrored}
          onMirrorToggle={() => setMirrored((v) => !v)}
          onPlaceholder={(label) => toast.message(`${label} · 敬请期待`)}
          onUpscale={() => {
            data.onQuickGenerate?.({
              promptAppend: ", ultra detailed, sharp focus, 4k clarity, intricate textures",
              paramsOverride: { size: "1024x1024" },
            });
            toast.message("正在按高清增强重新生成");
          }}
          onMultiAngle={() => {
            data.onQuickGenerate?.({
              promptAppend: ", multiple angles of the same subject, side view, 3/4 view, back view",
              paramsOverride: { batch: 4 },
            });
            toast.message("生成 4 张多视角变体");
          }}
          onRelight={() => {
            data.onQuickGenerate?.({
              promptAppend: ", soft cinematic lighting, golden hour, dramatic rim light",
            });
            toast.message("按新打光重新生成");
          }}
          onGrid9={() => {
            data.onQuickGenerate?.({
              promptAppend: ", grid composition variants",
              paramsOverride: { batch: 4 },
            });
            toast.message("生成一组九宫格变体");
          }}
          onOutpaint={() => {
            data.onQuickGenerate?.({
              promptAppend: ", wide-angle panoramic view, expanded scene, more environment",
              paramsOverride: { size: "1792x1024" },
            });
            toast.message("正在拓展画面");
          }}
          onStylize={() => {
            const STYLES = ["photo", "anime", "ink", "cyber", "oil", "minimal"];
            const next = STYLES[(styleIndexRef.current++) % STYLES.length];
            data.onQuickGenerate?.({
              paramsOverride: { style: next },
            });
            toast.message(`换风格 → ${next}`);
          }}
          onDownload={() => downloadImage(cover!, `lumen-${data.generationId ?? "image"}.png`)}
          onOpenLightbox={() => window.open(cover!, "_blank")}
          onSaveAsSubject={() => {
            const name = window.prompt("起一个主体名（@ 引用时用，不含空格）", "");
            if (!name) return;
            data.onSaveAsSubject?.(name);
          }}
          onSendToVideo={() => data.onSendToVideo?.()}
        />
      )}
      {showBottomPanel && (
        <FloatingExpandedPanel
          data={data}
          cover={cover}
          isRunning={isRunning}
          onPromptChange={(p) => data.onPromptChange?.(p)}
          onModelChange={(m) => data.onModelChange?.(m)}
          onParamsChange={(patch) => data.onParamsChange?.(patch)}
          onGenerate={() => data.onGenerate?.()}
          onPlaceholderAction={(label) => toast.message(`${label} · 敬请期待`)}
        />
      )}
    </div>
  );
}

/* ─── Floating top toolbar ─── */

interface TopProps {
  capabilities: ImageCapability[];
  mirrored: boolean;
  onMirrorToggle: () => void;
  onPlaceholder: (label: string) => void;
  onUpscale: () => void;
  onMultiAngle: () => void;
  onRelight: () => void;
  onGrid9: () => void;
  onOutpaint: () => void;
  onStylize: () => void;
  onDownload: () => void;
  onOpenLightbox: () => void;
  onSaveAsSubject: () => void;
  onSendToVideo: () => void;
}

/* ─── Choice picker (空态选择创作方式) ─── */

function ChoicePicker({
  onPickWriting, onPickUpload,
}: { onPickWriting: () => void; onPickUpload: () => void }) {
  return (
    <div className="nodrag absolute left-1/2 top-full z-30 mt-3 flex -translate-x-1/2 items-stretch gap-2 rounded-2xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur">
      <ChoiceCard
        icon={<Type className="size-5 text-brand-500" />}
        title="文生图"
        hint="写一段提示词，由模型生成"
        onClick={onPickWriting}
      />
      <ChoiceCard
        icon={<UploadCloud className="size-5 text-aurora-400" />}
        title="上传图片"
        hint="跳过生成，把现有图片放上来"
        onClick={onPickUpload}
      />
    </div>
  );
}

function ChoiceCard({
  icon, title, hint, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-44 flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-brand-400/40 hover:bg-secondary/50"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-secondary transition-colors group-hover:bg-card">
        {icon}
      </span>
      <span className="text-[13px] font-medium">{title}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>
    </button>
  );
}

function FloatingTopToolbar({
  capabilities, mirrored, onMirrorToggle, onPlaceholder,
  onUpscale, onMultiAngle, onRelight, onGrid9, onOutpaint, onStylize,
  onDownload, onOpenLightbox, onSaveAsSubject, onSendToVideo,
}: TopProps) {
  const has = (c: ImageCapability) => capabilities.includes(c);
  // Variation buttons depend on the model. Drop entirely if the current
  // model declares no capabilities — show only the always-on app actions.
  const hasAnyVariation = capabilities.length > 0;
  const showInpaint = has("inpaint");

  return (
    <div
      className="nodrag absolute bottom-full left-1/2 z-30 mb-3 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-border bg-popover/95 p-1 shadow-xl backdrop-blur"
    >
      {has("upscale")    && <ToolBtn icon={<Maximize2 className="size-3.5" />}      label="高清放大" onClick={onUpscale} badge="NEW" />}
      {has("multiAngle") && <ToolBtn icon={<Aperture className="size-3.5" />}       label="多视角"   onClick={onMultiAngle} />}
      {has("relight")    && <ToolBtn icon={<Sun className="size-3.5" />}            label="重打光"   onClick={onRelight} />}
      {has("grid9")      && <ToolBtn icon={<Grid3x3 className="size-3.5" />}        label="九宫格"   onClick={onGrid9} />}
      {has("outpaint")   && <ToolBtn icon={<Layers className="size-3.5" />}         label="拓展画面" onClick={onOutpaint} />}
      {has("stylize")    && <ToolBtn icon={<Globe className="size-3.5" />}          label="风格化"   onClick={onStylize} />}

      {hasAnyVariation && <div className="mx-1 h-5 w-px bg-border" />}

      {/* App-level actions — always available */}
      <ToolBtn icon={<UserPlus className="size-3.5" />}    label="存为主体" onClick={onSaveAsSubject} />
      <ToolBtn icon={<Clapperboard className="size-3.5" />} label="送到视频" onClick={onSendToVideo} />

      <div className="mx-1 h-5 w-px bg-border" />

      {showInpaint && (
        <ToolBtn icon={<Brush className="size-3.5" />} label="涂抹编辑" onClick={() => onPlaceholder("涂抹编辑")} iconOnly />
      )}
      <ToolBtn
        icon={<FlipHorizontal2 className={cn("size-3.5", mirrored && "text-brand-500")} />}
        label={mirrored ? "取消镜像" : "水平镜像"}
        onClick={onMirrorToggle}
        iconOnly
      />
      <ToolBtn icon={<Download className="size-3.5" />}  label="下载"     onClick={onDownload}     iconOnly />
      <ToolBtn icon={<Maximize2 className="size-3.5" />} label="放大查看" onClick={onOpenLightbox} iconOnly />
    </div>
  );
}

function ToolBtn({
  icon, label, onClick, iconOnly, badge,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  iconOnly?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] text-foreground transition-colors hover:bg-secondary",
        iconOnly ? "px-1.5" : "px-2",
      )}
    >
      {icon}
      {!iconOnly && <span>{label}</span>}
      {badge && (
        <span className="ml-0.5 rounded bg-brand-500/20 px-1 text-[9px] font-medium text-brand-500">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ─── Floating expanded panel below the node ─── */

interface ExpandedProps {
  data: ImageNodeData;
  cover?: string;
  isRunning: boolean;
  onPromptChange: (p: string) => void;
  onModelChange: (m: string) => void;
  onParamsChange: (patch: Partial<NonNullable<CanvasNodeData["imageParams"]>>) => void;
  onGenerate: () => void;
  onPlaceholderAction: (label: string) => void;
}

const ASPECT_PRESETS: Array<{ label: string; size: ImageParams["size"] }> = [
  { label: "智能",       size: "auto" },
  { label: "21:9 超宽",  size: "1792x768" },
  { label: "16:9 横图",  size: "1792x1024" },
  { label: "3:2 横图",   size: "1536x1024" },
  { label: "4:3 横图",   size: "1408x1024" },
  { label: "1:1 方图",   size: "1024x1024" },
  { label: "3:4 竖图",   size: "1024x1408" },
  { label: "2:3 竖图",   size: "1024x1536" },
  { label: "9:16 竖图",  size: "1024x1792" },
];

function aspectLabel(size: ImageParams["size"] | undefined): string {
  return ASPECT_PRESETS.find((a) => a.size === size)?.label ?? "1:1 方图";
}

function FloatingExpandedPanel({
  data, cover, isRunning, onPromptChange, onModelChange, onParamsChange,
  onGenerate, onPlaceholderAction,
}: ExpandedProps) {
  const imageModels = useImageModels();
  const model = findModel(data.modelId);
  const params = data.imageParams ?? {};
  const batch = (params.batch ?? 1) as 1 | 2 | 3 | 4;
  const seed = params.seed;
  const seedLocked = typeof seed === "number";
  const negative = params.negativePrompt ?? "";
  const totalCost = (model?.costPerCall ?? 0) * batch;

  const [modelOpen, setModelOpen] = React.useState(false);
  const [aspectOpen, setAspectOpen] = React.useState(false);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [seedOpen, setSeedOpen] = React.useState(false);
  const [negativeOpen, setNegativeOpen] = React.useState(false);

  // Single shared close-on-outside ref
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const open = modelOpen || aspectOpen || batchOpen || seedOpen || negativeOpen;
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setModelOpen(false); setAspectOpen(false); setBatchOpen(false);
        setSeedOpen(false); setNegativeOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [modelOpen, aspectOpen, batchOpen, seedOpen, negativeOpen]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    // Enter 生成，Shift+Enter 换行；中文输入法 composition 中的 Enter 不触发
    if (
      e.key === "Enter"
      && !e.shiftKey
      && !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onGenerate();
    }
  };

  return (
    <div
      ref={panelRef}
      className="nodrag absolute left-1/2 top-full z-30 mt-3 w-[24rem] -translate-x-1/2 rounded-2xl border border-border bg-popover/95 shadow-xl backdrop-blur"
    >
      {/* Top: thumbnail (only when there's a result) + 标记/聚焦 chips */}
      <div className="flex items-start gap-3 px-3 pt-3">
        {cover ? (
          <img
            src={cover}
            alt="source"
            className="size-12 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-secondary text-[10px] text-muted-foreground">
            未生成
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipBtn icon={<Tag className="size-3" />} label="标记" onClick={() => onPlaceholderAction("标记")} />
          <ChipBtn icon={<FocusIcon className="size-3" />} label="聚焦" onClick={() => onPlaceholderAction("聚焦")} />
        </div>
        <div className="flex-1" />
        {cover && (
          <button
            type="button"
            onClick={() => window.open(cover, "_blank")}
            className="text-muted-foreground hover:text-foreground"
            title="放大查看"
            aria-label="放大查看"
          >
            <Maximize2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Prompt editor */}
      <div className="px-3 py-2.5">
        <textarea
          value={data.prompt}
          onChange={(e) => { e.stopPropagation(); onPromptChange(e.target.value); }}
          onKeyDown={onKey}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="编辑提示词后按右下角发送即可重生成"
          className="nodrag nowheel min-h-24 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-relaxed placeholder:text-muted-foreground focus:outline-none focus:ring-0"
        />
      </div>

      {/* Bottom toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
        {/* Model */}
        <PopChip
          open={modelOpen}
          setOpen={(v) => { setModelOpen(v); setAspectOpen(false); setBatchOpen(false); setSeedOpen(false); setNegativeOpen(false); }}
          icon={<Sparkles className="size-3 text-brand-500" />}
          label={model?.name ?? "模型"}
          maxLabelWidth="110px"
        >
          <div className="max-h-56 w-56 overflow-y-auto p-1">
            {imageModels.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onModelChange(m.id); setModelOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  m.id === data.modelId ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{m.costPerCall} cr</span>
              </button>
            ))}
          </div>
        </PopChip>

        {/* Aspect */}
        <PopChip
          open={aspectOpen}
          setOpen={(v) => { setAspectOpen(v); setModelOpen(false); setBatchOpen(false); setSeedOpen(false); setNegativeOpen(false); }}
          icon={<MinusSquare className="size-3" />}
          label={aspectLabel(params.size)}
        >
          <div className="w-44 p-1">
            {ASPECT_PRESETS.map((a) => (
              <button
                key={a.size}
                type="button"
                onClick={() => { onParamsChange({ size: a.size }); setAspectOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  params.size === a.size ? "bg-secondary" : "hover:bg-secondary/60",
                )}
              >
                <span>{a.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{a.size}</span>
              </button>
            ))}
          </div>
        </PopChip>

        {/* Batch */}
        <PopChip
          open={batchOpen}
          setOpen={(v) => { setBatchOpen(v); setModelOpen(false); setAspectOpen(false); setSeedOpen(false); setNegativeOpen(false); }}
          icon={<Hash className="size-3" />}
          label={`${batch} 张`}
        >
          <div className="grid w-32 grid-cols-4 gap-1 p-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { onParamsChange({ batch: n as 1 | 2 | 3 | 4 }); setBatchOpen(false); }}
                className={cn(
                  "flex h-8 items-center justify-center rounded-md text-sm transition-colors",
                  batch === n ? "bg-foreground text-background" : "bg-secondary hover:bg-secondary/60",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </PopChip>

        {/* Seed */}
        <PopChip
          open={seedOpen}
          setOpen={(v) => { setSeedOpen(v); setModelOpen(false); setAspectOpen(false); setBatchOpen(false); setNegativeOpen(false); }}
          icon={seedLocked ? <Lock className="size-3" /> : <Dice5 className="size-3" />}
          label={seedLocked ? `种子 ${seed}` : "随机种子"}
        >
          <div className="w-56 space-y-2 p-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">种子</div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={seed ?? ""}
                placeholder="留空 = 随机"
                onChange={(e) => {
                  const v = e.target.value;
                  onParamsChange({ seed: v === "" ? undefined : Number(v) });
                }}
                onKeyDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag h-8 flex-1 rounded-md border border-input bg-background/40 px-2 text-xs"
              />
              <button
                type="button"
                onClick={() => onParamsChange({ seed: Math.floor(Math.random() * 1_000_000) })}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-secondary"
                title="随机一个种子并锁定"
              >
                <Dice5 className="size-3" />
                掷
              </button>
              <button
                type="button"
                onClick={() => onParamsChange({ seed: undefined })}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-secondary"
                title="解锁，每次随机"
              >
                <Unlock className="size-3" />
                解锁
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">锁定种子可在改 prompt / 比例 后保持构图骨架接近</p>
          </div>
        </PopChip>

        {/* Negative prompt */}
        <PopChip
          open={negativeOpen}
          setOpen={(v) => { setNegativeOpen(v); setModelOpen(false); setAspectOpen(false); setBatchOpen(false); setSeedOpen(false); }}
          icon={<MinusSquare className="size-3" />}
          label={negative ? `负向 ${negative.length}字` : "负向词"}
        >
          <div className="w-72 space-y-1 p-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">负向提示词</div>
            <textarea
              value={negative}
              onChange={(e) => { e.stopPropagation(); onParamsChange({ negativePrompt: e.target.value }); }}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="例如：低质量、模糊、多余手指"
              className="nodrag nowheel min-h-16 w-full resize-none rounded-md border border-input bg-background/40 px-2 py-1.5 text-xs"
            />
          </div>
        </PopChip>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => onPlaceholderAction("翻译")}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="翻译"
        >
          <Languages className="size-3.5" />
        </button>
        <span className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="size-3 text-brand-500" />
          {totalCost} cr
        </span>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isRunning || !data.prompt.trim()}
          className={cn(
            "ml-0.5 flex size-8 items-center justify-center rounded-full transition-all",
            data.prompt.trim() && !isRunning
              ? "bg-foreground text-background shadow hover:brightness-110 active:scale-95"
              : "bg-secondary text-muted-foreground cursor-not-allowed",
          )}
          title="重新生成（Enter · Shift+Enter 换行）"
          aria-label="重新生成"
        >
          {isRunning ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* Compact popover-chip used in the bottom toolbar */
function PopChip({
  open, setOpen, icon, label, maxLabelWidth, children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  icon: React.ReactNode;
  label: string;
  maxLabelWidth?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-foreground hover:bg-secondary"
      >
        {icon}
        <span className="truncate" style={maxLabelWidth ? { maxWidth: maxLabelWidth } : undefined}>
          {label}
        </span>
        <ChevronDown className="size-2.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-1 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function ChipBtn({
  icon, label, onClick, compact,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full text-[11px] transition-colors hover:bg-secondary",
        compact ? "h-7 px-2" : "h-7 border border-border bg-card px-2.5",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ─── Helpers ─── */

function downloadImage(url: string, filename: string) {
  // Works for both http(s) URLs and data: URIs
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
