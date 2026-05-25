"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Film, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import * as mpsApi from "@/lib/api/media-processing";
import { MEDIA_TOOLS } from "@/lib/director/media-tools";
import type { MediaProcessingTask } from "@/lib/types";

export default function ToolsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [tasks, setTasks] = React.useState<MediaProcessingTask[]>([]);

  React.useEffect(() => {
    mpsApi.getConfig().then((cfg) => setConfigured(mpsApi.isConfigured(cfg)));
    if (user) mpsApi.listTasks(user.id).then(setTasks);
  }, [user]);

  if (configured === null) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />载入中…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-6 xl:px-10 2xl:px-14">
      {/* 顶部介绍 + 配置状态 */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Film className="size-5 text-brand-400" />
          <h1 className="font-display text-3xl tracking-tight">工具</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          媒体处理任务 — 转码 / AIGC / 智能字幕 / 配音译制 / 媒体质检 等。
          底层走腾讯云 MPS。
        </p>
      </div>

      {!configured && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20">⚠️</span>
          <div className="flex-1">
            <div className="font-medium text-amber-600 dark:text-amber-400">媒体处理服务未启用</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              联系管理员到「管理后台 → 媒体处理」配置腾讯云 SecretId / SecretKey 并启用，本页工具卡片就能直接使用。
            </p>
          </div>
          {user?.role === "admin" && (
            <Button variant="brand" size="sm" onClick={() => router.push("/admin/media-processing")}>
              去配置 <ExternalLink className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* 工具网格 */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
        {MEDIA_TOOLS.map((tool) => {
          const disabled = !configured;
          return (
            <Link
              key={tool.id}
              href={disabled ? "#" : `/app/tools/${tool.id}`}
              onClick={(e) => { if (disabled) { e.preventDefault(); } }}
              className={[
                "group relative flex flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "border-border hover:border-brand-400/40 hover:bg-secondary/30",
              ].join(" ")}
            >
              <span className="text-2xl leading-none">{tool.icon}</span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium tracking-tight">{tool.name}</span>
                  {tool.badge && (
                    <Badge variant={tool.badge.tone} className="text-[9px]">
                      {tool.badge.label}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
                  {tool.hint}
                </p>
              </div>
              {!tool.implemented && (
                <span className="absolute right-2 top-2 rounded-full bg-zinc-700/70 px-1.5 py-0.5 text-[8px] text-zinc-200">
                  待接入
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* 最近任务 */}
      {tasks.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              我的任务 · 最近 {Math.min(tasks.length, 10)} 条
            </h2>
            <button
              type="button"
              onClick={() => {
                if (!user) return;
                if (!confirm("确定清空全部任务记录？此操作不影响腾讯云已生成的输出文件。")) return;
                tasks.forEach((t) => mpsApi.removeTaskSync(t.id));
                setTasks([]);
                toast.success("已清空任务记录");
              }}
              className="text-[11px] text-muted-foreground transition-colors hover:text-destructive"
            >
              清空全部
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">工具</th>
                  <th className="px-4 py-2 text-left">输入</th>
                  <th className="px-4 py-2 text-left">状态</th>
                  <th className="px-4 py-2 text-left">创建于</th>
                  <th className="w-10 px-4 py-2 text-right" />
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 10).map((t) => {
                  const meta = MEDIA_TOOLS.find((m) => m.id === t.toolId);
                  return (
                    <tr key={t.id} className="group border-t border-border/60 transition-colors hover:bg-secondary/30">
                      <td className="px-4 py-2">
                        <span className="mr-1">{meta?.icon}</span>
                        {meta?.name ?? t.toolId}
                      </td>
                      <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-muted-foreground" title={t.inputUrl}>
                        {t.inputUrl}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!confirm(`确定删除这条「${meta?.name ?? t.toolId}」任务记录？`)) return;
                            mpsApi.removeTaskSync(t.id);
                            setTasks((arr) => arr.filter((x) => x.id !== t.id));
                            toast.success("任务记录已删除");
                          }}
                          className="rounded-md p-1.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                          title="删除任务记录"
                          aria-label="删除任务记录"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: MediaProcessingTask["status"] }) {
  const map: Record<MediaProcessingTask["status"], { tone: "brand" | "muted" | "success" | "danger" | "warning"; label: string }> = {
    queued:    { tone: "muted",   label: "排队中" },
    running:   { tone: "brand",   label: "运行中" },
    succeeded: { tone: "success", label: "已完成" },
    failed:    { tone: "danger",  label: "失败" },
    cancelled: { tone: "muted",   label: "已取消" },
  };
  const v = map[status];
  return <Badge variant={v.tone}>{v.label}</Badge>;
}
