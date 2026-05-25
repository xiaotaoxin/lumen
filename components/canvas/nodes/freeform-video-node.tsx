"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Clapperboard, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type FreeformVideoNodeData = CanvasNodeData & {
  onDelete?: () => void;
};

export function FreeformVideoNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as FreeformVideoNodeData;
  const url = data.videoUrl;
  const poster = data.videoPosterUrl;

  return (
    <div
      className={cn(
        "group relative h-full w-full overflow-hidden border bg-card shadow-md transition-colors",
        selected ? "border-aurora-400/70" : "border-border",
      )}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={90}
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: "var(--background)",
          border: "2px solid var(--aurora-400)",
        }}
        lineStyle={{ borderColor: "var(--aurora-400)" }}
      />
      {url ? (
        <video
          src={url}
          poster={poster}
          controls
          className="block h-full w-full object-cover"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-secondary text-xs text-muted-foreground">
          <Clapperboard className="mr-1.5 size-4" />
          视频未加载
        </div>
      )}
      {data.onDelete && (
        <button
          type="button"
          onClick={data.onDelete}
          className="nodrag absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="删除"
          title="删除"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
