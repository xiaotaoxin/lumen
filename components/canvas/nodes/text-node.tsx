"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Trash2, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type TextNodeData = CanvasNodeData & {
  onPromptChange?: (text: string) => void;
  onDelete?: () => void;
};

/**
 * A pure text scratchpad node. Holds a piece of prose / script that can be
 * referenced visually next to generation nodes. Has an output handle so it
 * could one day be wired into a generation node's prompt input.
 */
export function TextNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as TextNodeData;

  return (
    <div
      className={cn(
        "w-72 overflow-visible rounded-2xl border bg-card text-card-foreground shadow-lg transition-all",
        selected ? "border-foreground/60 ring-2 ring-foreground/20" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-2 py-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-card">
          <Type className="size-3.5" />
        </span>
        <span className="text-[11px] font-medium">文本</span>
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
      <div className="px-3 py-2.5 nodrag">
        <textarea
          value={data.prompt}
          onChange={(e) => { e.stopPropagation(); data.onPromptChange?.(e.target.value); }}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="脚本 / 提示词模板"
          className="nodrag nowheel min-h-24 w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-snug placeholder:text-muted-foreground focus:outline-none focus:ring-0"
        />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3.5 !border-2 !border-background !bg-foreground/60 transition-transform hover:!scale-125"
      />
    </div>
  );
}
