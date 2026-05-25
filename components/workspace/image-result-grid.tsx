"use client";

import * as React from "react";
import { AlertTriangle, Download, Heart, Loader2, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PromptDisplay } from "./prompt-display";
import { findModel } from "@/lib/catalog";
import { hasRealAdapter } from "@/lib/providers/registry";
import { formatRelativeTime } from "@/lib/utils";
import type { Generation } from "@/lib/types";

export function ImageResultGrid({
  current,
  progress,
  onCancel,
  onRerun,
  onFavorite,
  onDelete,
  onUsePrompt,
}: {
  current: Generation | null;
  progress: number;
  onCancel?: () => void;
  onRerun?: (g: Generation) => void;
  onFavorite?: (g: Generation) => void;
  onDelete?: (g: Generation) => void;
  onUsePrompt?: (prompt: string) => void;
}) {
  if (!current) {
    return (
      <div className="grain flex h-full min-h-[480px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-1 p-10 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/20 to-aurora-400/20">
          <span className="font-display text-2xl">L</span>
        </div>
        <div className="font-display text-xl tracking-tight">从一句话开始</div>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          在左侧写下你的提示词，挑一个模型，按下「开始生成」。Lumen 会把生成结果展示在这里。
        </p>
      </div>
    );
  }

  const model = findModel(current.modelId);
  const isRunning = current.status === "running" || current.status === "queued";
  const isFailed = current.status === "failed";
  const params = current.imageParams;
  const grid = params?.batch ?? 1;

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
            </span>
            {current.durationMs && !isRunning && (
              <span className="text-xs text-muted-foreground">耗时 {(current.durationMs / 1000).toFixed(1)}s</span>
            )}
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
            <Button variant="ghost" size="icon-sm" onClick={() => onDelete?.(current)} title="删除">
              <Trash2 className="size-4" />
            </Button>
          )}
          {!isRunning && (
            <>
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

      {model && !hasRealAdapter(model.providerType, "image") && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>演示模式：该模型 Provider <code className="font-mono">{model.providerType}</code> 适配器未实现，结果由 mock 生成，没有真实调用上游。</span>
        </div>
      )}

      <div
        className={
          grid === 1
            ? "grid grid-cols-1 gap-4"
            : grid === 2
              ? "grid grid-cols-2 gap-4"
              : grid === 3
                ? "grid grid-cols-3 gap-4"
                : "grid grid-cols-2 gap-4"
        }
      >
        {Array.from({ length: grid }).map((_, i) => {
          const url = current.imageUrls?.[i];
          if (isRunning || (!url && !isFailed)) {
            return (
              <div
                key={i}
                className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-secondary"
              >
                <div className="aurora-bg absolute inset-0" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="size-6 animate-spin text-brand-400" />
                  <div className="text-xs text-muted-foreground">{Math.round(progress)}%</div>
                </div>
                <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-background/40">
                  <div
                    className="h-full bg-gradient-to-r from-brand-400 to-aurora-400 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            );
          }
          if (isFailed) {
            return (
              <div
                key={i}
                className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 text-xs text-muted-foreground"
              >
                未生成
              </div>
            );
          }
          return (
            <a
              key={i}
              href={url}
              download={`lumen-${current.id}-${i}.svg`}
              className="group relative aspect-square overflow-hidden rounded-2xl border border-border"
            >
              <img src={url} alt="generated" className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex items-center gap-1 text-xs text-white">
                  <Download className="size-3.5" /> 下载
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {!isRunning && current.status === "succeeded" && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span>结果已自动保存到 <Link href="/app/history" className="text-brand-500 hover:underline">我的作品</Link></span>
          <span>消耗 {current.cost ?? 0} cr</span>
        </div>
      )}
    </div>
  );
}
