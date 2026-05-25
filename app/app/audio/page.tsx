"use client";

/**
 * 音频工作站 — 统一入口
 *
 * 4 个 tab：
 *   配音 — CosyVoice 2 TTS + 声纹复刻
 *   字幕 — Qwen3-ASR 录音文件识别 → SRT
 *   分离 — Demucs 4 轨分离（人声 / 鼓 / 贝斯 / 其它）
 *   降噪 — DeepFilterNet 3（浏览器 wasm，本地处理）
 *
 * 路由原 /app/voice 已迁到 /app/audio。
 */

import * as React from "react";
import { Mic2, Subtitles, Music, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TtsPanel } from "./tts-panel";
import { AsrPanel } from "./asr-panel";
import { SeparatePanel } from "./separate-panel";
import { DenoisePanel } from "./denoise-panel";

type TabKey = "tts" | "asr" | "separate" | "denoise";

interface TabDef {
  key: TabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}

const TABS: TabDef[] = [
  { key: "tts",      label: "配音",  icon: Mic2,       hint: "CosyVoice 2 · 文本转语音 · 86 内置音色 + 声纹复刻" },
  { key: "asr",      label: "字幕",  icon: Subtitles,  hint: "Qwen3-ASR · 音视频转 SRT 字幕 · 52 语种 + 22 中文方言" },
  { key: "separate", label: "分离",  icon: Music,      hint: "Demucs · 4 轨人声 / 鼓 / 贝斯 / 其它 · HuggingFace Space" },
  { key: "denoise",  label: "降噪",  icon: Wand2,      hint: "DeepFilterNet 3 · 浏览器本地 wasm · 数据不出本机" },
];

export default function AudioPage() {
  const [tab, setTab] = React.useState<TabKey>("tts");
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="mx-auto max-w-7xl p-8">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <Mic2 className="size-5 text-aurora-400" />
          <h1 className="font-display text-3xl tracking-tight">音频工作站</h1>
          <Badge variant="brand" className="text-[10px]">CosyVoice · Qwen-ASR · Demucs · DeepFilterNet</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{current.hint}</p>
      </header>

      {/* tabs 切换条 */}
      <div className="mb-6 inline-flex h-10 items-center gap-1 rounded-xl bg-secondary p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 4 个 panel 始终挂载，仅靠 hidden 切换 —— 切 tab 不丢已合成结果 / blob URL */}
      <div hidden={tab !== "tts"}><TtsPanel /></div>
      <div hidden={tab !== "asr"}><AsrPanel /></div>
      <div hidden={tab !== "separate"}><SeparatePanel /></div>
      <div hidden={tab !== "denoise"}><DenoisePanel /></div>
    </div>
  );
}
