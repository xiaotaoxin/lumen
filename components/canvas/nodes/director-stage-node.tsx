"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, Trash2, Edit3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CanvasNodeData } from "@/lib/types";

type DirectorStageNodeData = CanvasNodeData & {
  onOpen?: () => void;
  onDelete?: () => void;
  onRename?: (name: string) => void;
  /** 缩略图 URL（编辑器保存时回传） */
  thumbnailDataUrl?: string;
  /** 关联的 directorStageId（已经创建过） */
  directorStageId?: string;
};

/**
 * 节点流画布里的"导演台"卡片。
 *
 * 与 image/video 节点不同，它本身**不参与生成管线**——只是一张"3D 构图编辑器"
 * 的入口卡片。点 "打开导演台" 跳到 /app/director/[id] 全屏编辑。
 *
 * 编辑器保存时会回写 thumbnailDataUrl 到本节点 data 上，下次进画布看到的
 * 就是构图缩略图而非占位图。
 */
export function DirectorStageNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as DirectorStageNodeData;
  const hasThumb = !!data.thumbnailDataUrl;

  return (
    <div
      className={cn(
        "w-72 overflow-visible rounded-2xl border bg-card text-card-foreground shadow-lg transition-all",
        selected ? "border-foreground/60 ring-2 ring-foreground/20" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-2 py-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-card">
          <Edit3 className="size-3.5" />
        </span>
        <span className="truncate text-[11px] font-medium">{data.prompt || "导演台"}</span>
        <div className="flex-1" />
        {data.onDelete && (
          <button
            type="button"
            onClick={data.onDelete}
            className="nodrag text-muted-foreground hover:text-destructive"
            aria-label="删除节点"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <div
        className="nodrag flex aspect-square items-center justify-center bg-gradient-to-br from-surface-2 to-card p-4"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {hasThumb ? (
          // 编辑器保存的构图缩略图
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.thumbnailDataUrl}
            alt="导演台构图"
            className="size-full rounded-xl object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/20 to-aurora-400/20">
              <Layers className="size-7 text-brand-400" />
            </span>
            <div>
              <div className="font-display text-sm tracking-tight">导演台</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">3D 构图编辑器</div>
            </div>
            <Button
              variant="brand"
              size="sm"
              onClick={(e) => { e.stopPropagation(); data.onOpen?.(); }}
              className="text-xs"
            >
              打开导演台
            </Button>
          </div>
        )}
      </div>

      {hasThumb && (
        <div className="border-t border-border p-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); data.onOpen?.(); }}
            className="w-full text-xs"
          >
            重新构图
          </Button>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!size-3.5 !border-2 !border-background !bg-foreground/60 transition-transform hover:!scale-125"
      />
    </div>
  );
}
