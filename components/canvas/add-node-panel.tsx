"use client";

import * as React from "react";
import { Clapperboard, Edit3, ImageIcon, ImagePlus, Layers, Type, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasNodeKind } from "@/lib/types";

export type AddNodeAction =
  | { kind: "image" }
  | { kind: "video" }
  | { kind: "text" }
  | { kind: "upload" }
  | { kind: "director-stage" }
  | { kind: "template"; templateId: TemplateId };

export type TemplateId = "text-to-image" | "image-to-video" | "text-to-video";

interface Props {
  onPick: (action: AddNodeAction) => void;
  className?: string;
}

interface NodeOption {
  kind: AddNodeAction["kind"];
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "node" | "asset";
  badge?: string;
}

const OPTIONS: NodeOption[] = [
  { kind: "text",            label: "文本",       hint: "脚本 / 提示词模板，可被多个节点引用", icon: Type,        group: "node" },
  { kind: "image",           label: "图像",       hint: "用提示词生成一张或多张图像",        icon: ImageIcon,   group: "node" },
  { kind: "video",           label: "视频",       hint: "从一张静帧延展成短视频",            icon: Clapperboard,group: "node" },
  { kind: "director-stage",  label: "导演台",     hint: "3D 构图编辑器，定机位、摆角色",     icon: Edit3,       group: "node", badge: "new" },
  { kind: "upload",          label: "上传图片",   hint: "把现有图作为参考放到画布",          icon: ImagePlus,   group: "asset" },
];

const TEMPLATES: Array<{ id: TemplateId; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "text-to-image", label: "文生图",     hint: "1 个图像节点",            icon: ImageIcon },
  { id: "image-to-video", label: "图生视频",  hint: "图像 → 视频 已连好",      icon: Clapperboard },
  { id: "text-to-video", label: "文字生视频", hint: "文本 → 图像 → 视频 链",   icon: Wand2 },
];

/**
 * Vertical panel listing addable node types and quick templates.
 * Used both by the left rail's "+" and by the empty-state on canvas.
 */
export function AddNodePanel({ onPick, className }: Props) {
  const nodeOptions = OPTIONS.filter((o) => o.group === "node");
  const assetOptions = OPTIONS.filter((o) => o.group === "asset");

  return (
    <div
      className={cn(
        "w-64 overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl",
        className,
      )}
    >
      <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        添加节点
      </div>
      <div className="space-y-0.5 px-1.5 pb-2">
        {nodeOptions.map((o) => (
          <PanelRow
            key={o.kind}
            icon={o.icon}
            label={o.label}
            hint={o.hint}
            badge={o.badge}
            onClick={() => onPick({ kind: o.kind } as AddNodeAction)}
          />
        ))}
      </div>

      <div className="border-t border-border" />

      <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        添加资源
      </div>
      <div className="space-y-0.5 px-1.5 pb-2">
        {assetOptions.map((o) => (
          <PanelRow
            key={o.kind}
            icon={o.icon}
            label={o.label}
            hint={o.hint}
            onClick={() => onPick({ kind: o.kind } as AddNodeAction)}
          />
        ))}
      </div>

      <div className="border-t border-border" />

      <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        快捷模板
      </div>
      <div className="space-y-0.5 px-1.5 pb-2">
        {TEMPLATES.map((t) => (
          <PanelRow
            key={t.id}
            icon={t.icon}
            label={t.label}
            hint={t.hint}
            onClick={() => onPick({ kind: "template", templateId: t.id })}
          />
        ))}
      </div>
    </div>
  );
}

function PanelRow({
  icon: Icon, label, hint, badge, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-secondary"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-card text-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
          {label}
          {badge && (
            <span className="rounded bg-brand-500/15 px-1 text-[9px] font-medium text-brand-500">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

// suppress unused — Layers reserved for future "图层"/"播放列表" node category
void Layers;
