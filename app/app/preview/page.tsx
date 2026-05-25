"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Play, Pause, SkipBack, SkipForward, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PipelineGuide } from "@/components/workspace/pipeline-guide";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function fetchJson<T>(path: string): Promise<T> {
  const token = (await import("@/lib/api/client")).getToken();
  const res = await fetch(`${BACKEND}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

interface Frame {
  id: string; orderIndex: number; shotDescription: string;
  imageUrl?: string; videoUrl?: string; dialogue?: string; speaker?: string;
  duration: number; status: string;
}

export default function PreviewPage() {
  return <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="size-6 animate-spin" /></div>}><PreviewInner /></Suspense>;
}

function PreviewInner() {
  const router = useRouter();
  const search = useSearchParams();
  const storyboardId = search.get("sb");
  const title = search.get("title") || "成片预览";

  const [frames, setFrames] = React.useState<Frame[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [current, setCurrent] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (!storyboardId) { setLoading(false); return; }
    fetchJson<{ frames: Frame[] }>(`/storyboards/${storyboardId}`)
      .then(data => setFrames(data.frames || []))
      .finally(() => setLoading(false));
  }, [storyboardId]);

  // Auto-play with per-frame duration
  React.useEffect(() => {
    if (playing && frames.length > 0) {
      const advance = () => {
        setCurrent(prev => {
          if (prev >= frames.length - 1) { setPlaying(false); return prev; }
          const next = prev + 1;
          const dur = (frames[next]?.duration || 3) * 1000;
          timerRef.current = setTimeout(advance, dur);
          return next;
        });
      };
      const dur = (frames[current]?.duration || 3) * 1000;
      timerRef.current = setTimeout(advance, dur);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, current, frames]);

  const currentFrame = frames[current];
  const videosDone = frames.filter(f => f.videoUrl).length;

  return (
    <div className="flex h-full flex-col">
      <PipelineGuide />
      <div className="flex-1 overflow-y-auto bg-black">
        {loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="size-8 animate-spin text-white/50" /></div>
        ) : frames.length === 0 ? (
          <div className="flex h-full items-center justify-center text-white/50 text-sm">没有帧数据</div>
        ) : (
          <div className="mx-auto max-w-5xl flex flex-col items-center py-8 space-y-6">
            {/* Title */}
            <div className="text-center">
              <h1 className="text-white font-display text-2xl">{title}</h1>
              <p className="text-white/40 text-sm mt-1">{frames.length} 帧 · {videosDone} 个视频 · 总长 {frames.reduce((s, f) => s + (f.duration || 3), 0).toFixed(0)} 秒</p>
            </div>

            {/* Main viewer */}
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
              {currentFrame?.videoUrl ? (
                <img src={currentFrame.videoUrl} className="absolute inset-0 h-full w-full object-contain" alt="" />
              ) : currentFrame?.imageUrl ? (
                <img src={currentFrame.imageUrl} className="absolute inset-0 h-full w-full object-contain" alt="" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm">帧 #{current + 1} 未生成</div>
              )}

              {/* Frame info overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-6 z-10">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-white border-white/20 text-[10px]">#{current + 1}</Badge>
                  {currentFrame?.speaker && <span className="text-white/80 text-sm font-medium">{currentFrame.speaker}</span>}
                </div>
                <p className="text-white/60 text-sm">{currentFrame?.shotDescription}</p>
                {currentFrame?.dialogue && (
                  <p className="text-white/40 text-xs italic mt-1">"{currentFrame.dialogue}"</p>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon-sm" className="text-white/60 hover:text-white" onClick={() => setCurrent(0)} disabled={current === 0}>
                <SkipBack className="size-5" />
              </Button>
              <Button variant="outline" size="lg" className="rounded-full size-14 border-white/20 text-white hover:bg-white/10" onClick={() => setPlaying(!playing)}>
                {playing ? <Pause className="size-6" /> : <Play className="size-6 ml-0.5" />}
              </Button>
              <Button variant="ghost" size="icon-sm" className="text-white/60 hover:text-white" onClick={() => setCurrent(frames.length - 1)} disabled={current >= frames.length - 1}>
                <SkipForward className="size-5" />
              </Button>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-2xl flex items-center gap-1 px-4">
              {frames.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => { setCurrent(i); setPlaying(false); }}
                  className={`h-1 flex-1 rounded-full transition-all ${i === current ? "bg-white" : i < current ? "bg-white/40" : f.videoUrl ? "bg-white/20" : "bg-white/10"}`}
                />
              ))}
            </div>

            {/* Filmstrip */}
            <div className="w-full overflow-x-auto pb-4">
              <div className="flex gap-2 min-w-max px-4">
                {frames.map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => { setCurrent(i); setPlaying(false); }}
                    className={`shrink-0 w-32 aspect-video rounded-lg overflow-hidden border-2 transition-all ${i === current ? "border-white" : "border-transparent opacity-60 hover:opacity-90"}`}
                  >
                    {(f.videoUrl || f.imageUrl) ? (
                      <img src={f.videoUrl || f.imageUrl} className="h-full w-full object-cover" alt={`Frame ${i + 1}`} />
                    ) : (
                      <div className="h-full w-full bg-zinc-800 flex items-center justify-center text-[10px] text-white/30">#{i + 1}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Export note */}
            <div className="text-center text-white/30 text-xs">
              <Check className="size-3 inline mr-1" />
              预览模式：每帧展示 3 秒。安装 ffmpeg 后可导出真实视频
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
