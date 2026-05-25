"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ArrowRight, BookOpen, Camera, Clapperboard, Download, Film, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function fetchJson(path: string) {
  try {
    const token = (await import("@/lib/api/client")).getToken();
    const res = await fetch(`${BACKEND}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

interface StepDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  check: () => Promise<boolean>;
}

export function PipelineGuide() {
  const router = useRouter();
  const [steps, setSteps] = React.useState<Array<StepDef & { done: boolean }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const defs: StepDef[] = [
        {
          key: "script", label: "剧本分析", icon: BookOpen, href: "/app/script",
          check: async () => {
            const subjects = await fetchJson("/subjects") as Array<{ id: string }>;
            return subjects.length >= 2; // Has some subjects created from script
          },
        },
        {
          key: "subjects", label: "角色设定图", icon: User, href: "/app/subjects",
          check: async () => {
            const subjects = await fetchJson("/subjects") as Array<{ id: string }>;
            return subjects.length >= 3;
          },
        },
        {
          key: "storyboard", label: "创建分镜", icon: Camera, href: "/app/storyboards",
          check: async () => {
            const boards = await fetchJson("/storyboards") as Array<{ id: string }>;
            return boards.length > 0;
          },
        },
        {
          key: "frames", label: "生成分镜图", icon: Film, href: "/app/storyboards",
          check: async () => {
            const boards = await fetchJson("/storyboards") as Array<{ id: string; frameCount: number }>;
            return boards.some((b: { frameCount: number }) => b.frameCount > 0);
          },
        },
        {
          key: "video", label: "图生视频", icon: Clapperboard, href: "/app/image-to-video",
          check: async () => false,
        },
        {
          key: "series", label: "组成剧集", icon: BookOpen, href: "/app/series",
          check: async () => {
            const series = await fetchJson("/series") as Array<{ episodeCount: number }>;
            return series.some((s: { episodeCount: number }) => s.episodeCount > 0);
          },
        },
        {
          key: "export", label: "导出成片", icon: Download, href: "/app/series",
          check: async () => false,
        },
      ];

      const results = await Promise.all(defs.map(async (d) => ({ ...d, done: await d.check() })));
      if (!cancelled) {
        setSteps(results);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };

    // Re-check every 30 seconds
    const interval = setInterval(load, 30000);
    return () => { clearInterval(interval); };
  }, []);

  if (loading || steps.length === 0) return null;

  const firstIncomplete = steps.findIndex(s => !s.done);
  const nextStep = firstIncomplete >= 0 ? steps[firstIncomplete] : null;
  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length - 1; // -1 for export which is always manual

  if (collapsed) {
    return (
      <div className="border-b border-border/60 bg-surface-1/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-2">
          <button onClick={() => setCollapsed(false)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <span className="flex size-5 items-center justify-center rounded-full bg-brand-500/20 text-brand-600 text-[10px] font-medium">{doneCount}/{steps.length - 1}</span>
            创作进度
          </button>
          {nextStep && !allDone && (
            <button onClick={() => router.push(nextStep.href)} className="text-xs text-brand-500 hover:underline flex items-center gap-1 ml-auto">
              {nextStep.label} <ArrowRight className="size-3" />
            </button>
          )}
        </div>
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
        <div className="flex items-center gap-1">
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
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all whitespace-nowrap",
                    isDone && "bg-brand-500/10 text-brand-600 hover:bg-brand-500/20",
                    isCurrent && "bg-brand-500 text-white shadow-sm",
                    !isDone && !isCurrent && "text-muted-foreground hover:bg-secondary",
                  )}
                >
                  {isDone ? (
                    <Check className="size-3" />
                  ) : (
                    <step.icon className="size-3" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </motion.button>
                {!isLast && (
                  <div className={cn("h-px w-3 sm:w-4", isDone ? "bg-brand-500/40" : "bg-border")} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Next step hint */}
        {nextStep && !allDone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-2 flex items-center gap-2 text-xs"
          >
            <span className="text-muted-foreground">下一步：</span>
            <button
              onClick={() => router.push(nextStep.href)}
              className="inline-flex items-center gap-1 text-brand-500 hover:underline font-medium"
            >
              {nextStep.label}
              <ArrowRight className="size-3" />
            </button>
          </motion.div>
        )}

        {allDone && (
          <div className="mt-2 text-xs text-muted-foreground">
            🎉 全部完成！去<button onClick={() => router.push("/app/series")} className="text-brand-500 hover:underline mx-0.5">剧集页</button>导出成片
          </div>
        )}
      </div>
    </div>
  );
}
