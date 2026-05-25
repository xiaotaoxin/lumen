"use client";

import * as React from "react";
import { type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type FreeformTextNodeData = CanvasNodeData & {
  onPromptChange?: (text: string) => void;
  onDelete?: () => void;
  width?: number;
};

export function FreeformTextNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as FreeformTextNodeData;
  const width = data.width ?? 240;
  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card shadow-md transition-all",
        selected ? "border-foreground/60 ring-2 ring-foreground/20" : "border-border",
      )}
      style={{ width }}
    >
      <div className="px-3 py-2.5 nodrag">
        <textarea
          value={data.prompt}
          onChange={(e) => { e.stopPropagation(); data.onPromptChange?.(e.target.value); }}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="一段文字 / 笔记 / 灵感"
          className="nodrag nowheel min-h-16 w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-snug placeholder:text-muted-foreground focus:outline-none focus:ring-0"
        />
      </div>
      {data.onDelete && (
        <button
          type="button"
          onClick={data.onDelete}
          className="nodrag absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          aria-label="删除"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
