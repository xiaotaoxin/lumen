"use client";

import * as React from "react";
import { AlertTriangle, Film, Heart, Loader2, RefreshCw, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PromptDisplay } from "./prompt-display";
import { findModel } from "@/lib/catalog";
import { hasRealAdapter } from "@/lib/providers/registry";
import { formatRelativeTime } from "@/lib/utils";
import type { Generation } from "@/lib/types";

interface Props {
  current: Generation;
  progress: number;
  onCancel?: () => void;
  onRerun?: (g: Generation) => void;
  onFavorite?: (g: Generation) => void;
  onDelete?: (g: Generation) => void;
  onUsePrompt?: (prompt: string) => void;
  /** 把视频的首帧 / 尾帧 / 当前帧塞进 composer 的参考图槽 */
  onUseFrameAsReference?: (dataUrl: string, kind: "first" | "last" | "current") => void;
}

export function VideoResultCard({
  current, progress, onCancel, onRerun, onFavorite, onDelete, onUsePrompt, onUseFrameAsReference,
}: Props) {
  const model = findModel(current.modelId);
  const isRunning = current.status === "running" || current.status === "queued";
  const isFailed = current.status === "failed";
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [extracting, setExtracting] = React.useState<null | "first" | "last" | "current">(null);

  const extractFrame = async (kind: "first" | "last" | "current") => {
    if (!current.videoUrl || !onUseFrameAsReference) return;
    setExtracting(kind);
    try {
      // 用一个独立的 <video> 元素跑 seek + canvas 截帧（不依赖播放中的元素）
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = current.videoUrl;
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res();
        v.onerror = () => rej(new Error("加载视频失败（链接可能已过期）"));
      });
      const t = kind === "first" ? 0
              : kind === "last" ? Math.max(0, v.duration - 0.05)
              : (videoRef.current?.currentTime ?? 0);
      await new Promise<void>((res, rej) => {
        v.onseeked = () => res();
        v.onerror = () => rej(new Error("跳转帧失败"));
        try { v.currentTime = t; } catch (e) { rej(e as Error); }
      });
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      onUseFrameAsReference(dataUrl, kind);
      const label = kind === "first" ? "首帧" : kind === "last" ? "尾帧" : "当前帧";
      toast.success(`已把${label}作为参考图加入下次生成`);
    } catch (e) {
      toast.error(`提取失败：${(e as Error).message}`);
    } finally {
      setExtracting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant={isFailed ? "danger" : isRunning ? "brand" : "success"}>
              {isFailed ? "失败" : isRunning ? "生成中" : "完成"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {model?.name} · {formatRelativeTime(current.createdAt)}
              {current.durationMs && !isRunning && ` · 耗时 ${(current.durationMs / 1000).toFixed(1)}s`}
            </span>
          </div>
          <div className="mt-2">
            <PromptDisplay prompt={current.prompt} onUse={onUsePrompt} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isRunning && onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>取消</Button>
          )}
          {isRunning && onDelete && (
            // 给僵尸 running 一个出口：直接从 storage 删除
            <Button variant="ghost" size="icon-sm" onClick={() => onDelete?.(current)} title="删除">
              <Trash2 className="size-4" />
            </Button>
          )}
          {!isRunning && (
            <>
              {/* 首尾帧 / 当前帧 提取（仅在有真实 videoUrl 时启用）*/}
              {current.videoUrl && onUseFrameAsReference && (
                <>
                  <Button
                    variant="ghost" size="icon-sm"
                    disabled={extracting !== null}
                    onClick={() => extractFrame("first")}
                    title="提取首帧 → 用作下次生成的参考"
                  >
                    {extracting === "first" ? <Loader2 className="size-4 animate-spin" /> : <SkipBack className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon-sm"
                    disabled={extracting !== null}
                    onClick={() => extractFrame("current")}
                    title="提取当前帧 → 用作下次生成的参考"
                  >
                    {extracting === "current" ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon-sm"
                    disabled={extracting !== null}
                    onClick={() => extractFrame("last")}
                    title="提取尾帧 → 用作下次生成的参考"
                  >
                    {extracting === "last" ? <Loader2 className="size-4 animate-spin" /> : <SkipForward className="size-4" />}
                  </Button>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                </>
              )}
              <Button variant="ghost" size="icon-sm" onClick={() => onFavorite?.(current)} title="收藏">
                <Heart className={`size-4 ${current.favorite ? "fill-brand-500 text-brand-500" : ""}`} />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => onRerun?.(current)} title="重跑">
                <RefreshCw className="size-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => onDelete?.(current)} title="删除">
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {isFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {current.errorMessage ?? "生成失败"}
        </div>
      )}

      {model && !hasRealAdapter(model.providerType, "video") && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>演示模式：该模型 Provider <code className="font-mono">{model.providerType}</code> 适配器未实现，结果由 mock 生成，没有真实调用上游。</span>
        </div>
      )}

      <div className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-secondary">
        {/* Order: real videoUrl > poster (mock) > reference still > aurora placeholder */}
        {current.videoUrl ? (
          <video
            ref={videoRef}
            src={current.videoUrl}
            controls
            playsInline
            preload="metadata"
            crossOrigin="anonymous"
            poster={current.videoPosterUrl || current.videoParams?.referenceImageUrl}
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : current.videoPosterUrl ? (
          <img src={current.videoPosterUrl} alt="poster" className="absolute inset-0 h-full w-full object-cover" />
        ) : current.videoParams?.referenceImageUrl ? (
          <img src={current.videoParams.referenceImageUrl} alt="reference" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        ) : (
          <div className="aurora-bg absolute inset-0" />
        )}
        {isRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 text-white">
            <Loader2 className="size-7 animate-spin text-brand-400" />
            <div className="font-display text-2xl">{Math.round(progress)}%</div>
            <div className="text-xs text-white/70">视频生成比图像慢，请耐心等候</div>
          </div>
        )}
        {/* Mock-only badge — only shown for the placeholder (no real videoUrl) */}
        {!isRunning && current.status === "succeeded" && !current.videoUrl && (
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white">
            <span>演示阶段无真实视频流，已生成静帧海报</span>
            <span className="font-mono">{current.videoParams?.duration}s · {current.videoParams?.resolution} · {current.videoParams?.camera}</span>
          </div>
        )}
      </div>
    </div>
  );
}

