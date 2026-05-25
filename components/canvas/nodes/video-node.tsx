"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  ChevronDown, Clapperboard, Loader2, Pencil, RefreshCw, Trash2, Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { findModel, useVideoModels } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type VideoNodeData = CanvasNodeData & {
  onPromptChange?: (prompt: string) => void;
  onModelChange?: (modelId: string) => void;
  onGenerate?: () => void;
  onDelete?: () => void;
  inputImageUrl?: string;
};

export function VideoNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as VideoNodeData;
  const videoModels = useVideoModels();
  const model = findModel(data.modelId);
  const isRunning = data.status === "running";
  const isFailed = data.status === "failed";
  const isSucceeded = data.status === "succeeded";
  const isIdle = data.status === "idle";
  const cover = data.videoPosterUrl ?? data.inputImageUrl;
  const progress = Math.round(data.progress ?? 0);
  const [editingPrompt, setEditingPrompt] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
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

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    // Enter 生成，Shift+Enter 换行；中文输入法 composition 中的 Enter 不触发
    if (
      e.key === "Enter"
      && !e.shiftKey
      && !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      data.onGenerate?.();
    }
  };

  const canGenerate = !!data.inputImageUrl && !!data.prompt.trim() && !isRunning;

  return (
    <div
      className={cn(
        "w-80 overflow-visible rounded-2xl border bg-card text-card-foreground shadow-lg transition-all",
        selected ? "border-aurora-400/70 ring-2 ring-aurora-400/30" : "border-border",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3.5 !border-2 !border-background !bg-aurora-400 transition-transform hover:!scale-125"
      />

      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-2 py-1.5">
        <div className="relative" ref={modelPopRef}>
          <button
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            className="nodrag inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] hover:bg-secondary"
          >
            <Clapperboard className="size-3 text-aurora-400" />
            <span className="max-w-[120px] truncate">{model?.name ?? "选择模型"}</span>
            <ChevronDown className="size-2.5 text-muted-foreground" />
          </button>
          {modelOpen && (
            <div className="nodrag absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
              <div className="max-h-56 overflow-y-auto p-1">
                {videoModels.map((m) => (
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
                      <Clapperboard className="size-3" />
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
          variant={isFailed ? "danger" : isRunning ? "brand" : isSucceeded ? "success" : data.inputImageUrl ? "muted" : "warning"}
          className="text-[10px] py-0 px-1.5"
        >
          {isFailed ? "失败" : isRunning ? `${progress}%` : isSucceeded ? "完成" : data.inputImageUrl ? "待生成" : "缺输入"}
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

      {/* Preview frame: shows input ref or generated poster */}
      <div className="relative aspect-video w-full bg-secondary">
        {cover ? (
          <img src={cover} alt={data.prompt} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="aurora-bg absolute inset-0 flex items-center justify-center">
            <div className="text-[11px] text-muted-foreground">从左侧连入图像</div>
          </div>
        )}
        {isRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
            <Loader2 className="size-6 animate-spin text-aurora-400" />
            <div className="font-display text-lg">{progress}%</div>
          </div>
        )}
        {isFailed && (
          <div className="absolute inset-x-2 bottom-2 rounded-md bg-destructive/80 px-2 py-1 text-[11px] text-destructive-foreground">
            {data.errorMessage ?? "生成失败"}
          </div>
        )}
      </div>

      {/* Prompt editor / display */}
      <div className="px-3 py-2.5 nodrag">
        {(isIdle || editingPrompt || isFailed) ? (
          <>
            <textarea
              value={data.prompt}
              onChange={(e) => { e.stopPropagation(); data.onPromptChange?.(e.target.value); }}
              onKeyDown={onTextareaKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
              autoFocus={editingPrompt || (isIdle && data.prompt === "")}
              placeholder="镜头与动作 · 例如：相机缓慢左移，云层快速流动"
              className="nodrag nowheel min-h-14 w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-snug placeholder:text-muted-foreground focus:outline-none focus:ring-0"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {data.inputImageUrl ? "Enter 生成 · Shift+Enter 换行" : "需要先连入图像"}
              </span>
              <button
                type="button"
                onClick={() => { data.onGenerate?.(); setEditingPrompt(false); }}
                disabled={!canGenerate}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-all",
                  canGenerate
                    ? "bg-foreground text-background hover:brightness-110 active:scale-95"
                    : "bg-secondary text-muted-foreground cursor-not-allowed",
                )}
              >
                {isRunning ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                {isFailed ? "重试" : "生成"}
              </button>
            </div>
          </>
        ) : (
          <div className="group flex items-start gap-2">
            <p className="line-clamp-2 flex-1 text-[11px] leading-snug text-muted-foreground">
              {data.prompt || "（无提示词）"}
            </p>
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => setEditingPrompt(true)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="编辑提示词"
                title="编辑提示词"
              >
                <Pencil className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => data.onGenerate?.()}
                className="text-muted-foreground hover:text-foreground"
                aria-label="重新生成"
                title="重新生成"
              >
                <RefreshCw className="size-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!size-3.5 !border-2 !border-background !bg-aurora-400 transition-transform hover:!scale-125"
      />
    </div>
  );
}
