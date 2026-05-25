"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROP_PRESETS,
  CHARACTER_PRESETS,
  CAMERA_PRESETS,
  TEMPLATE_PRESETS,
  type PropPreset,
  type CharacterPreset,
  type CameraPreset,
  type TemplatePreset,
} from "@/lib/director/asset-presets";

type Tab = "props" | "characters" | "cameras" | "templates";

interface Props {
  onClose: () => void;
  onPickProp: (p: PropPreset) => void;
  onPickCharacter: (p: CharacterPreset) => void;
  onPickCamera: (p: CameraPreset) => void;
  onPickTemplate: (p: TemplatePreset) => void;
}

export function AssetLibrary({
  onClose, onPickProp, onPickCharacter, onPickCamera, onPickTemplate,
}: Props) {
  const [tab, setTab] = React.useState<Tab>("props");
  const [q, setQ] = React.useState("");
  const Q = q.trim().toLowerCase();

  const filterByName = <T extends { name: string; hint?: string }>(items: T[]): T[] =>
    Q ? items.filter((i) => i.name.toLowerCase().includes(Q) || (i.hint?.toLowerCase().includes(Q))) : items;

  return (
    <div className="w-72 rounded-xl border border-white/[0.06] bg-[#101015]/90 p-2 text-zinc-200 backdrop-blur-xl shadow-2xl shadow-black/40">
      {/* 标题 + 关闭 */}
      <div className="flex items-center px-1 pb-1.5 pt-1">
        <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-300">
          资产库
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-100"
          aria-label="关闭资产库"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* 4 个 Tab */}
      <div className="mb-2 flex items-center gap-0.5 border-b border-white/[0.06]">
        {([
          ["props", "道具"],
          ["characters", "人物"],
          ["cameras", "机位"],
          ["templates", "模板"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors",
              tab === key ? "text-amber-300" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {label}
            {tab === key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {/* 搜索 */}
      <div className="relative mb-2">
        <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索资产…"
          className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 pl-7 pr-2 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus-visible:border-amber-400/50 focus-visible:outline-none"
        />
      </div>

      {/* 列表 */}
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === "props" && (
          <div className="grid grid-cols-2 gap-1.5">
            {filterByName(PROP_PRESETS).map((p) => (
              <AssetCard
                key={p.id}
                icon={p.icon}
                title={p.name}
                onClick={() => onPickProp(p)}
              />
            ))}
          </div>
        )}

        {tab === "characters" && (
          <div className="space-y-1.5">
            {filterByName(CHARACTER_PRESETS).map((p) => (
              <AssetRow
                key={p.id}
                icon={p.icon}
                title={p.name}
                hint={p.hint}
                onClick={() => onPickCharacter(p)}
              />
            ))}
          </div>
        )}

        {tab === "cameras" && (
          <div className="grid grid-cols-2 gap-1.5">
            {filterByName(CAMERA_PRESETS.map((c) => ({ ...c, hint: `FOV ${c.fov}°` }))).map((p) => (
              <AssetCard
                key={p.id}
                icon="📷"
                title={p.name}
                onClick={() => onPickCamera(p)}
              />
            ))}
          </div>
        )}

        {tab === "templates" && (
          <div className="space-y-1.5">
            {filterByName(TEMPLATE_PRESETS).map((p) => (
              <AssetRow
                key={p.id}
                icon={p.icon}
                title={p.name}
                hint={p.hint}
                onClick={() => onPickTemplate(p)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 道具 / 机位 用方格卡片（图标在上、文字在下） */
function AssetCard({
  icon, title, onClick,
}: {
  icon: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-3 text-zinc-300 transition-colors hover:border-amber-400/40 hover:bg-amber-400/10 hover:text-amber-100"
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-medium leading-tight">{title}</span>
    </button>
  );
}

/** 人物 / 模板 用横排卡片（图标 + 主标 + 副标） */
function AssetRow({
  icon, title, hint, onClick,
}: {
  icon: string;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2 text-left transition-colors hover:border-amber-400/40 hover:bg-amber-400/10"
    >
      <span className="text-xl leading-none">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium leading-tight text-zinc-100 group-hover:text-amber-100">{title}</span>
        {hint && (
          <span className="mt-0.5 block truncate text-[10px] leading-tight text-zinc-500">{hint}</span>
        )}
      </span>
    </button>
  );
}
