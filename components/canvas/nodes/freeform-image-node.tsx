"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type FreeformImageNodeData = CanvasNodeData & {
  onDelete?: () => void;
};

/**
 * Free-placement image card. Square corners (no rounded), no edges, with
 * 4-corner resize handles when selected.
 */
export function FreeformImageNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as FreeformImageNodeData;
  const url = data.imageUrls?.[0];

  return (
    <div
      className={cn(
        "group relative h-full w-full overflow-hidden border bg-card shadow-md transition-colors",
        selected ? "border-brand-400/70" : "border-border",
      )}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={120}
        minHeight={80}
        // Only corner handles to keep the UI clean
        handleStyle={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: "var(--background)",
          border: "2px solid var(--brand-500)",
        }}
        lineStyle={{ borderColor: "var(--brand-400)" }}
      />
      {url ? (
        <img
          src={url}
          alt={data.prompt || "image"}
          className="block h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="h-full w-full bg-secondary" />
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
