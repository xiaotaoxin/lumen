"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronRight, GripVertical, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/store/auth-store";
import * as sessionsApi from "@/lib/api/sessions";
import * as sbApi from "@/lib/api/storyboards";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await import("@/lib/api/client")).getToken();
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers as Record<string, string> || {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface SeriesItem { id: string; title: string; description: string; coverUrl?: string; episodeCount: number; createdAt: string; updatedAt: string; }
interface SeriesFull extends SeriesItem { episodes: EpisodeItem[]; }
interface EpisodeItem { id: string; seriesId: string; sessionId?: string; storyboardId?: string; orderIndex: number; title: string; sessionTitle?: string; storyboardTitle?: string; }
interface SessionRow { id: string; title: string; kind: string; }
interface StoryboardRow { id: string; title: string; }

export default function SeriesPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [list, setList] = React.useState<SeriesItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [active, setActive] = React.useState<SeriesFull | null>(null);
  const [showAddEp, setShowAddEp] = React.useState(false);
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [storyboards, setStoryboards] = React.useState<StoryboardRow[]>([]);

  const reload = React.useCallback(async () => {
    try { setList(await api("/series")); } catch { /* noop */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { if (user) reload(); }, [user]);

  const createSeries = async () => {
    try { await api("/series", { method: "POST", body: JSON.stringify({ title: "新剧集" }) }); reload(); } catch { toast.error("创建失败"); }
  };

  const openSeries = async (id: string) => {
    try { setActive(await api(`/series/${id}`)); } catch { toast.error("加载失败"); }
  };

  const deleteSeries = async (id: string) => {
    try { await api(`/series/${id}`, { method: "DELETE" }); reload(); if (active?.id === id) setActive(null); } catch { /* noop */ }
  };

  const addEpisode = async (type: "session" | "storyboard", sourceId: string) => {
    if (!active) return;
    const src = type === "session" ? sessions.find(s => s.id === sourceId) : storyboards.find(s => s.id === sourceId);
    try {
      await api(`/series/${active.id}/episodes`, { method: "POST", body: JSON.stringify({ [type === "session" ? "sessionId" : "storyboardId"]: sourceId, title: src?.title || "未命名" }) });
      openSeries(active.id);
      setShowAddEp(false);
    } catch { toast.error("添加失败"); }
  };

  const removeEpisode = async (epId: string) => {
    if (!active) return;
    try { await api(`/series/${active.id}/episodes/${epId}`, { method: "DELETE" }); openSeries(active.id); } catch { /* noop */ }
  };

  const openAddEp = async () => {
    try {
      const [s, sb] = await Promise.all([api<SessionRow[]>("/sessions"), api<StoryboardRow[]>("/storyboards")]);
      setSessions(s); setStoryboards(sb); setShowAddEp(true);
    } catch { toast.error("加载资源失败"); }
  };

  if (active) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setActive(null)}>← 返回</Button>
          <Input
            value={active.title}
            onChange={e => setActive(p => p ? { ...p, title: e.target.value } : null)}
            onBlur={() => { api(`/series/${active.id}`, { method: "PATCH", body: JSON.stringify({ title: active.title }) }).catch(() => {}); }}
            className="h-8 w-48 font-medium border-0 text-lg px-0 focus-visible:ring-0"
          />
          <div className="flex-1" />
          <Badge variant="muted">{active.episodes?.length || 0} 集</Badge>
          <Button variant="outline" size="sm" onClick={openAddEp}><Plus className="size-3.5" /> 添加剧集</Button>
        </div>

        <Textarea
          placeholder="剧集简介…"
          value={active.description}
          onChange={e => setActive(p => p ? { ...p, description: e.target.value } : null)}
          onBlur={() => { api(`/series/${active.id}`, { method: "PATCH", body: JSON.stringify({ description: active.description }) }).catch(() => {}); }}
          className="min-h-20 text-sm mb-6 resize-none"
        />

        <div className="space-y-1">
          {active.episodes?.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-muted-foreground text-sm">还没有剧集，点击"添加剧集"关联会话或分镜</div>
          ) : (
            active.episodes?.map((ep, i) => (
              <div key={ep.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary/60 transition-colors">
                <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{ep.title}</div>
                  <div className="text-[11px] text-muted-foreground">{ep.sessionTitle || ep.storyboardTitle || "—"}</div>
                </div>
                {ep.sessionId && (
                  <Button variant="ghost" size="icon-sm" onClick={() => router.push(`/app/text-to-image?s=${ep.sessionId}`)} title="打开会话"><ChevronRight className="size-3.5" /></Button>
                )}
                {ep.storyboardId && (
                  <Button variant="ghost" size="icon-sm" onClick={() => router.push(`/app/storyboards`)} title="打开分镜"><ChevronRight className="size-3.5" /></Button>
                )}
                <Button variant="ghost" size="icon-sm" onClick={() => removeEpisode(ep.id)}><Trash2 className="size-3.5 text-muted-foreground" /></Button>
              </div>
            ))
          )}
        </div>

        {/* Add episode dialog */}
        <Dialog open={showAddEp} onOpenChange={setShowAddEp}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>添加剧集</DialogTitle><DialogDescription>选择已有的会话或分镜加入剧集</DialogDescription></DialogHeader>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {sessions.length > 0 && <div className="text-xs font-medium text-muted-foreground mb-1">创作会话</div>}
              {sessions.map(s => (
                <div key={s.id} onClick={() => addEpisode("session", s.id)} className="flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer hover:border-brand-400/30">
                  <span className="text-sm flex-1 truncate">{s.title}</span>
                  <Badge variant="muted" className="text-[10px]">{s.kind === "image" ? "图" : "视频"}</Badge>
                  <Plus className="size-3.5 text-muted-foreground" />
                </div>
              ))}
              {storyboards.length > 0 && <div className="text-xs font-medium text-muted-foreground mb-1 mt-2">分镜</div>}
              {storyboards.map(s => (
                <div key={s.id} onClick={() => addEpisode("storyboard", s.id)} className="flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer hover:border-brand-400/30">
                  <span className="text-sm flex-1 truncate">{s.title}</span>
                  <Plus className="size-3.5 text-muted-foreground" />
                </div>
              ))}
              {sessions.length === 0 && storyboards.length === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center">还没有会话或分镜，先去创作吧</div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">剧集</h1>
          <p className="mt-2 text-sm text-muted-foreground">把多个会话和分镜组织成连续剧集。</p>
        </div>
        <Button variant="brand" onClick={createSeries}><Plus className="size-4" /> 新建剧集</Button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-muted-foreground">
          <BookOpen className="size-10 mb-3" />
          <p className="text-sm">还没有剧集，创建第一个开始组织你的故事</p>
          <Button variant="brand" size="sm" className="mt-4" onClick={createSeries}><Plus className="size-4" /> 新建剧集</Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map(s => (
            <div key={s.id} onClick={() => openSeries(s.id)} className="group cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-400/30">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{s.title}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{s.episodeCount} 集</Badge>
                  <button onClick={e => { e.stopPropagation(); deleteSeries(s.id); }} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
              <div className="mt-2 text-[11px] text-muted-foreground">创建于 {new Date(s.createdAt).toLocaleDateString("zh-CN")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
