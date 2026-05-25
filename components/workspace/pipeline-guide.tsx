"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, BookOpen, Camera, Clapperboard, Download, Film, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function fetchJson(path: string) {
  try {
    const token = (await import("@/lib/api/client")).getToken();
    const res = await fetch(`${BACKEND}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}

const STEPS = [
  { key: "script", label: "剧本分析", icon: BookOpen, href: "/app/script",
    check: async () => { const s = await fetchJson("/subjects") as Array<unknown>; return s.length >= 2; } },
  { key: "subjects", label: "角色设定", icon: User, href: "/app/subjects",
    check: async () => { const s = await fetchJson("/subjects") as Array<unknown>; return s.length >= 3; } },
  { key: "storyboard", label: "创建分镜", icon: Camera, href: "/app/script",
    check: async () => { const b = await fetchJson("/storyboards") as Array<unknown>; return b.length > 0; } },
  { key: "frames", label: "生成分镜图", icon: Film, href: "/app/script",
    check: async () => { const b = await fetchJson("/storyboards") as Array<{ id: string; frameCount: number }>; return b.some(x => x.frameCount > 0); } },
  { key: "video", label: "图生视频", icon: Clapperboard, href: "/app/script",
    check: async () => { const b = await fetchJson("/storyboards") as Array<{ id: string }>; if (!b.length) return false; const f = await fetchJson(`/storyboards/${b[0].id}`) as { frames?: Array<{ videoUrl?: string }> }; return f.frames?.some(x => x.videoUrl) || false; } },
  { key: "series", label: "组成剧集", icon: BookOpen, href: "/app/script",
    check: async () => { const s = await fetchJson("/series") as Array<{ episodeCount: number }>; return s.some(x => x.episodeCount > 0); } },
  { key: "export", label: "导出成片", icon: Download, href: "/app/script",
    check: async () => false },
];

export function PipelineGuide() {
  const router = useRouter();
  const [steps, setSteps] = React.useState<Array<typeof STEPS[number] & { done: boolean }>>([]);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const results = await Promise.all(STEPS.map(async d => ({ ...d, done: await d.check() })));
      if (!cancelled) setSteps(results);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (steps.length === 0) return null;

  const firstIncomplete = steps.findIndex(s => !s.done);
  const doneCount = steps.filter(s => s.done).length;

  if (collapsed) {
    return (
      <div className="border-b border-border/60 bg-surface-1/80 backdrop-blur-sm">
        <button onClick={() => setCollapsed(false)} className="flex items-center gap-2 px-6 py-2 text-xs text-muted-foreground hover:text-foreground w-full">
          <span className="flex size-5 items-center justify-center rounded-full bg-brand-500/20 text-brand-600 text-[10px] font-medium">{doneCount}/{steps.length - 1}</span>
          创作进度
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-border/60 bg-surface-1/80 backdrop-blur-sm">
      <div className="mx-auto max-w-3xl px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">创作流水线</span>
          <button onClick={() => setCollapsed(true)} className="text-[10px] text-muted-foreground hover:text-foreground">收起</button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {steps.map((step, i) => {
            const isDone = step.done;
            const isCurrent = i === firstIncomplete;
            const isLast = i === steps.length - 1;
            return (
              <React.Fragment key={step.key}>
                <motion.button
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  onClick={() => router.push(step.href)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors",
                    isDone && "bg-brand-500/10 text-brand-600 hover:bg-brand-500/20",
                    isCurrent && "bg-brand-500 text-white shadow-sm hover:brightness-110",
                    !isDone && !isCurrent && "text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : <step.icon className="size-3" />}
                  <span className="hidden sm:inline">{step.label}</span>
                </motion.button>
                {!isLast && <div className={cn("h-px w-3 sm:w-4", isDone ? "bg-brand-500/40" : "bg-border")} />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
