"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Clapperboard, FileEdit, ImageIcon,
  PanelLeftClose, PanelLeftOpen, Trash2,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth-store";
import { useSessionsStore } from "@/lib/store/sessions-store";
import * as sessionsApi from "@/lib/api/sessions";
import * as historyApi from "@/lib/api/history";
import type { Generation, Session } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

type Bucket = "today" | "yesterday" | "week" | "older";

const BUCKET_LABELS: Record<Bucket, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "7 天前",
  older: "更早",
};

function bucketOf(date: Date | string): Bucket {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400_000;
  const startOfSeven = startOfToday - 7 * 86400_000;
  const t = d.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfYesterday) return "yesterday";
  if (t >= startOfSeven) return "week";
  return "older";
}

interface SessionRow {
  session: Session;
  cover?: string;
  preview: string;
}

export function ConversationSidebar({ collapsed, onToggle }: Props) {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();
  const search = useSearchParams();
  const reloadKey = useSessionsStore((s) => s.reloadKey);
  const bump = useSessionsStore((s) => s.bump);
  const currentSessionId = search.get("s");

  const [rows, setRows] = React.useState<SessionRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Derive a row per session: cover comes from the latest generation in
  // the session, preview from the latest non-empty prompt. We do this by
  // fetching the generation list once and indexing it.
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      sessionsApi.listMine(user.id),
      historyApi.listMine(user.id),
    ]).then(([sessions, gens]) => {
      if (cancelled) return;
      const bySession = new Map<string, Generation[]>();
      for (const g of gens) {
        if (!g.sessionId) continue;
        const list = bySession.get(g.sessionId) ?? [];
        list.push(g);
        bySession.set(g.sessionId, list);
      }
      const next: SessionRow[] = sessions.map((s) => {
        const items = (bySession.get(s.id) ?? []).sort(
          (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
        );
        const latest = items[0];
        const cover = latest
          ? latest.kind === "image"
            ? latest.imageUrls?.[0]
            : latest.videoPosterUrl
          : undefined;
        return { session: s, cover, preview: latest?.prompt?.split("\n")[0] ?? s.title };
      });
      setRows(next);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, reloadKey]);

  // Bucket sessions by their updatedAt —— 必须在 collapsed 早返回之前调用，
  // 否则展开 / 收起时 hook 顺序改变会触发 rules-of-hooks
  const grouped = React.useMemo(() => {
    const map: Record<Bucket, SessionRow[]> = {
      today: [], yesterday: [], week: [], older: [],
    };
    for (const r of rows) {
      map[bucketOf(r.session.updatedAt)].push(r);
    }
    return map;
  }, [rows]);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-border/60 bg-surface-1 py-4">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="展开侧栏"
          title="展开侧栏"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
      </aside>
    );
  }

  const activeBase = pathname.startsWith("/app/image-to-video")
    ? "/app/image-to-video"
    : "/app/text-to-image";
  const onBlankRoute =
    !currentSessionId &&
    (pathname === "/app/text-to-image" || pathname === "/app/image-to-video");

  const onDelete = async (s: Session, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await sessionsApi.remove(s.id);
    toast.success("已删除该对话");
    bump();
  };

  const ORDER: Bucket[] = ["today", "yesterday", "week", "older"];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/60 bg-surface-1">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="font-display text-base tracking-tight">开启创作</div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="收起侧栏"
          title="收起侧栏"
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      {/* Pinned: 新建创作 */}
      <div className="px-2">
        <Link
          href={activeBase}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
            onBlankRoute
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-card text-foreground">
            <FileEdit className="size-4" />
          </span>
          <span className="flex-1">新建创作</span>
        </Link>
      </div>

      {/* Sessions grouped by date */}
      <div className="mt-3 flex-1 overflow-y-auto pb-4">
        {loading ? (
          <div className="space-y-1 px-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-secondary/60" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
            还没有创作，从上面的「新建创作」开始第一段对话吧。
          </div>
        ) : (
          ORDER.map((bucket) => {
            const list = grouped[bucket];
            if (list.length === 0) return null;
            return (
              <section key={bucket} className="mb-2">
                <div className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                  {BUCKET_LABELS[bucket]}
                </div>
                <ul className="space-y-0.5 px-2">
                  {list.map(({ session, cover, preview }) => {
                    const route = session.kind === "image"
                      ? "/app/text-to-image"
                      : "/app/image-to-video";
                    const isActive = currentSessionId === session.id;
                    return (
                      <li key={session.id}>
                        <Link
                          href={`${route}?s=${session.id}`}
                          className={cn(
                            "group flex items-start gap-2.5 rounded-lg px-2 py-2 text-xs transition-colors",
                            isActive
                              ? "bg-secondary text-foreground"
                              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                          )}
                        >
                          <div className="size-8 shrink-0 overflow-hidden rounded-md bg-secondary">
                            {cover ? (
                              <img src={cover} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                {session.kind === "image" ? (
                                  <ImageIcon className="size-3.5" />
                                ) : (
                                  <Clapperboard className="size-3.5" />
                                )}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] leading-tight">
                              {session.title || preview || "未命名创作"}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {formatRelativeTime(session.updatedAt)}
                            </div>
                          </div>
                          <button
                            onClick={(e) => onDelete(session, e)}
                            className="opacity-0 transition-opacity group-hover:opacity-100"
                            aria-label="删除"
                          >
                            <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                          </button>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </aside>
  );
}
