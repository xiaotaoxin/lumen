"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImagePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CanvasNodeData } from "@/lib/types";

type UploadNodeData = CanvasNodeData & {
  onImageChange?: (url?: string) => void;
  onDelete?: () => void;
};

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Static image node — user uploads an image, no generation. The image
 * appears at `data.imageUrls[0]` so video nodes can use it as input via
 * the existing edge → input-image resolution path.
 */
export function UploadNode({ data: rawData, selected }: NodeProps) {
  const data = rawData as UploadNodeData;
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const url = data.imageUrls?.[0];

  const onPickFile = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(`图片不能大于 ${MAX_BYTES / 1024 / 1024} MB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => data.onImageChange?.(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={cn(
        "w-64 overflow-visible rounded-2xl border bg-card text-card-foreground shadow-lg transition-all",
        selected ? "border-brand-400/70 ring-2 ring-brand-400/30" : "border-border",
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-2 py-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-card">
          <ImagePlus className="size-3.5" />
        </span>
        <span className="text-[11px] font-medium">上传图片</span>
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
      <div className="p-3 nodrag">
        {url ? (
          <div className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary">
            <img src={url} alt="upload" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => data.onImageChange?.(undefined)}
              className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="清除"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-card transition-colors hover:border-brand-400/40"
          >
            <ImagePlus className="size-5 text-muted-foreground" />
            <div className="text-[11px] text-muted-foreground">点击上传</div>
            <div className="text-[10px] text-muted-foreground/70">PNG / JPG ≤ 20MB</div>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3.5 !border-2 !border-background !bg-brand-500 transition-transform hover:!scale-125"
      />
    </div>
  );
}
