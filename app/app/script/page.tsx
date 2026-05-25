"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Loader2, Sparkles, Upload, Check, ArrowRight, Play, Plus, Trash2,
  User, MapPin, Box, Camera, ChevronUp, ChevronDown, Film,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = (await import("@/lib/api/client")).getToken();
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers as Record<string, string> || {}) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `HTTP ${res.status}`);
  return res.json();
}

interface CharItem { name: string; description: string; tags: string[]; }
interface SceneItem { name: string; description: string; timeOfDay: string; tags: string[]; }
interface ShotItem { sceneName: string; shotSize: string; cameraAngle: string; cameraMovement: string; dialogue: string; speaker: string; description: string; }
interface FrameItem {
  id: string; storyboardId: string; orderIndex: number; shotDescription: string; shotSize: string;
  cameraAngle: string; cameraMovement: string; dialogue: string; speaker: string;
  imagePrompt: string; imageUrl?: string; videoUrl?: string; status: string; errorMessage?: string;
}

const EXAMPLE = `# 月光下的约定

深夜，古老钟楼敲响十二下。小夜裹紧深蓝斗篷穿过长廊，紫色眼眸警惕扫视，手里紧握白银匕首。
"你终于来了。"守护者从石柱后走出，暗红长袍轻摆，右眼旧伤疤在月光下清晰可见。
"把钥匙交出来。"小夜举起匕首。守护者轻笑，取出怀中发光的月长石："打开那扇门的代价，你付不起。"`;

const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写"];
const CAMERA_ANGLES = ["平视", "俯视", "仰视"];
const CAMERA_MOVEMENTS = ["固定", "慢推", "横移", "跟拍"];

type Phase = "input" | "analysis" | "generating" | "done";

export default function ScriptPage() {
  // Script input
  const [text, setText] = React.useState("");
  const [analyzing, setAnalyzing] = React.useState(false);
  // Analysis result
  const [analysis, setAnalysis] = React.useState<{ title: string; characters: CharItem[]; scenes: SceneItem[]; props: { name: string; description: string; tags: string[] }[]; shots: ShotItem[] } | null>(null);
  // Apply state
  const [applying, setApplying] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  const [storyboardId, setStoryboardId] = React.useState<string | null>(null);
  // Frames (loaded after apply)
  const [frames, setFrames] = React.useState<FrameItem[]>([]);
  const [phase, setPhase] = React.useState<Phase>("input");
  // Series
  const [seriesId, setSeriesId] = React.useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  // Past boards
  const [boards, setBoards] = React.useState<Array<{ id: string; title: string; frameCount: number; updatedAt: string }>>([]);
  const [loadingBoards, setLoadingBoards] = React.useState(true);

  React.useEffect(() => {
    fetchJson<Array<{ id: string; title: string; frameCount: number; updatedAt: string }>>("/storyboards")
      .then(setBoards).finally(() => setLoadingBoards(false));
  }, []);

  const loadBoard = async (boardId: string) => {
    try {
      const full = await fetchJson<{ id: string; title: string; frames: FrameItem[] }>(`/storyboards/${boardId}`);
      setStoryboardId(full.id);
      setFrames(full.frames || []);
      setApplied(true);
      setPhase("generating");
      setAnalysis({ title: full.title, characters: [], scenes: [], props: [], shots: [] });
      toast.success(`已加载：${full.title}`);
    } catch { toast.error("加载失败"); }
  };

  const deleteBoard = async (boardId: string) => {
    try {
      await fetchJson(`/storyboards/${boardId}`, { method: "DELETE" });
      setBoards(prev => prev.filter(b => b.id !== boardId));
      if (storyboardId === boardId) { setStoryboardId(null); setFrames([]); setApplied(false); setPhase("input"); setAnalysis(null); }
      toast.success("已删除");
    } catch { toast.error("删除失败"); }
  };

  // Load frames
  const loadFrames = React.useCallback(async () => {
    if (!storyboardId) return;
    try {
      const full = await fetchJson<{ frames: FrameItem[] }>(`/storyboards/${storyboardId}`);
      setFrames(full.frames || []);
    } catch { /* noop */ }
  }, [storyboardId]);

  // Poll frames while generating
  React.useEffect(() => {
    if (!storyboardId || !applied) return;
    loadFrames();
    const interval = setInterval(loadFrames, 3000);
    return () => clearInterval(interval);
  }, [storyboardId, applied, loadFrames]);

  // Step 1: Analyze
  const analyze = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    try {
      const r = await fetchJson<typeof analysis>("/script/analyze", { method: "POST", body: JSON.stringify({ text: text.trim() }) });
      setAnalysis(r); setPhase("analysis");
    } catch (e) { toast.error((e as Error).message); }
    finally { setAnalyzing(false); }
  };

  // Step 2: Apply (create subjects + storyboard)
  const apply = async () => {
    if (!analysis) return;
    setApplying(true);
    try {
      const r = await fetchJson<{ subjects: string[]; storyboardFrames: string[]; storyboardId: string[] }>("/script/apply", { method: "POST", body: JSON.stringify(analysis) });
      setStoryboardId(r.storyboardId?.[0] || null);
      setApplied(true); setPhase("generating");
      toast.success(`已创建 ${r.subjects?.length || 0} 素材 + ${r.storyboardFrames?.length || 0} 分镜`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setApplying(false); }
  };

  // Frame actions
  const updateFrame = async (fid: string, patch: Record<string, unknown>) => {
    if (!storyboardId) return;
    setFrames(prev => prev.map(f => f.id === fid ? { ...f, ...patch } : f));
    try { await fetchJson(`/storyboards/${storyboardId}/frames/${fid}`, { method: "PATCH", body: JSON.stringify(patch) }); } catch { /* noop */ }
  };

  const deleteFrame = async (fid: string) => {
    if (!storyboardId) return;
    setFrames(prev => prev.filter(f => f.id !== fid));
    try { await fetchJson(`/storyboards/${storyboardId}/frames/${fid}`, { method: "DELETE" }); } catch { /* noop */ }
  };

  const moveFrame = async (fid: string, dir: -1 | 1) => {
    const idx = frames.findIndex(f => f.id === fid);
    if (idx < 0 || (dir === -1 && idx === 0) || (dir === 1 && idx === frames.length - 1)) return;
    const next = [...frames];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    setFrames(next);
    try { await fetchJson(`/storyboards/${storyboardId}/frames/reorder`, { method: "POST", body: JSON.stringify({ ids: next.map(f => f.id) }) }); } catch { /* noop */ }
  };

  const addFrame = async () => {
    if (!storyboardId) return;
    try {
      const f = await fetchJson<FrameItem>(`/storyboards/${storyboardId}/frames`, { method: "POST", body: "{}" });
      setFrames(prev => [...prev, f]);
    } catch { /* noop */ }
  };

  const generateFrame = async (fid: string) => {
    if (!storyboardId) return;
    setFrames(prev => prev.map(f => f.id === fid ? { ...f, status: "running" } : f));
    try { await fetchJson(`/storyboards/${storyboardId}/frames/${fid}/generate`, { method: "POST" }); loadFrames(); } catch (e) {
      setFrames(prev => prev.map(f => f.id === fid ? { ...f, status: "failed", errorMessage: (e as Error).message } : f));
    }
  };

  const generateVideo = async (fid: string) => {
    if (!storyboardId) return;
    setFrames(prev => prev.map(f => f.id === fid ? { ...f, status: "running" } : f));
    try { await fetchJson(`/storyboards/${storyboardId}/frames/${fid}/generate-video`, { method: "POST" }); loadFrames(); } catch (e) {
      setFrames(prev => prev.map(f => f.id === fid ? { ...f, status: "failed", errorMessage: (e as Error).message } : f));
    }
  };

  const generateAll = async () => {
    const idle = frames.filter(f => f.status !== "succeeded" && f.status !== "running");
    for (const f of idle) { await new Promise(r => setTimeout(r, 500)); generateFrame(f.id); }
  };

  const generateAllVideos = async () => {
    const ready = frames.filter(f => f.status === "succeeded" && f.imageUrl);
    for (const f of ready) { await new Promise(r => setTimeout(r, 500)); generateVideo(f.id); }
  };

  // Create series from storyboard
  const createSeries = async () => {
    try {
      const s = await fetchJson<{ id: string }>("/series", { method: "POST", body: JSON.stringify({ title: analysis?.title || "未命名剧集" }) });
      await fetchJson(`/series/${s.id}/episodes`, { method: "POST", body: JSON.stringify({ storyboardId, title: analysis?.title || "第1集" }) });
      setSeriesId(s.id);
      toast.success("已创建剧集！");
    } catch (e) { toast.error((e as Error).message); }
  };

  const allImagesDone = frames.length > 0 && frames.every(f => f.imageUrl);
  const allVideosDone = frames.length > 0 && frames.every(f => f.videoUrl);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-8 space-y-8">

          <div>
            <h1 className="font-display text-3xl tracking-tight">创作流水线</h1>
            <p className="mt-2 text-sm text-muted-foreground">从剧本到成片，一站式完成</p>
          </div>

          {/* ── Past boards list ── */}
          {phase === "input" && !analysis && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">之前的创作</h2>
                <span className="text-xs text-muted-foreground">{boards.length} 个</span>
              </div>
              {loadingBoards ? (
                <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary" />)}</div>
              ) : boards.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4">暂无，下面开始第一个</div>
              ) : (
                <div className="space-y-2">
                  {boards.map(b => (
                    <div key={b.id} className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 group hover:border-brand-400/20 transition-colors">
                      <button onClick={() => loadBoard(b.id)} className="flex-1 text-left">
                        <div className="text-sm font-medium">{b.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{b.frameCount} 帧 · {new Date(b.updatedAt).toLocaleDateString("zh-CN")}</div>
                      </button>
                      <button onClick={() => deleteBoard(b.id)} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-4">
                <div className="text-sm font-medium mb-3">新建创作</div>
              </div>
            </section>
          )}

          {/* ── Phase: Input ── */}
          {(phase === "input" || phase === "analysis") && (
            <section className="space-y-4">
              <div className="flex gap-2 text-sm">
                <button onClick={() => setText(EXAMPLE)} className="text-brand-500 hover:underline">试试示例剧本</button>
                <label className="cursor-pointer text-muted-foreground hover:text-foreground">
                  <Upload className="size-4 inline mr-1" />上传 TXT
                  <input type="file" accept=".txt,.md" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]; if (f) { setText(await f.text()); toast.success(`已加载：${f.name}`); }
                  }} />
                </label>
              </div>
              <Textarea
                placeholder="在此粘贴或直接输入剧本…"
                value={text} onChange={e => setText(e.target.value)}
                className="min-h-40 text-sm font-mono resize-y"
              />
              <Button variant="brand" size="lg" onClick={analyze} disabled={!text.trim() || analyzing} className="w-full">
                {analyzing ? <><Loader2 className="size-4 animate-spin" /> AI 分析中…</> : <><Sparkles className="size-4" /> 开始分析</>}
              </Button>
            </section>
          )}

          {/* ── Phase: Analysis ── */}
          {analysis && (
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button onClick={() => { setAnalysis(null); setApplied(false); setStoryboardId(null); setFrames([]); setPhase("input"); setSeriesId(null); }} className="text-xs text-muted-foreground hover:text-foreground">← 返回列表</button>
                  <h2 className="font-display text-2xl">{analysis.title}</h2>
                </div>
                {!applied && (
                  <Button variant="brand" onClick={apply} disabled={applying}>
                    {applying ? <><Loader2 className="size-4 animate-spin" /> 创建中…</> : <><Sparkles className="size-4" /> 一键创建素材和分镜</>}
                  </Button>
                )}
                {applied && <Badge variant="muted" className="text-emerald-500"><Check className="size-3" /> 已创建</Badge>}
              </div>

              {/* Characters / Scenes / Props summary */}
              <div className="grid grid-cols-3 gap-4">
                <Cell icon={User} label="角色" count={analysis.characters.length} color="text-amber-500">
                  {analysis.characters.map((ch, i) => <div key={i} className="text-xs"><span className="font-medium">{ch.name}</span> — {ch.description.slice(0, 40)}…</div>)}
                </Cell>
                <Cell icon={MapPin} label="场景" count={analysis.scenes.length} color="text-emerald-500">
                  {analysis.scenes.map((sc, i) => <div key={i} className="text-xs"><span className="font-medium">{sc.name}</span> {sc.timeOfDay}</div>)}
                </Cell>
                <Cell icon={Box} label="道具" count={analysis.props.length} color="text-purple-500">
                  {analysis.props.map((pr, i) => <div key={i} className="text-xs"><span className="font-medium">{pr.name}</span></div>)}
                </Cell>
              </div>
            </motion.section>
          )}

          {/* ── Phase: Storyboard Frames (after apply) ── */}
          {applied && storyboardId && (
            <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-xl">分镜镜头</h2>
                <Badge variant="muted">{frames.length} 帧</Badge>
                <Button variant="outline" size="sm" onClick={generateAll} disabled={!frames.length || frames.every(f => f.status === "succeeded")}>
                  <Sparkles className="size-3.5" /> 全部生图
                </Button>
                <Button variant="outline" size="sm" onClick={generateAllVideos} disabled={!frames.some(f => f.imageUrl)}>
                  <Play className="size-3.5" /> 全部生视频
                </Button>
                {allVideosDone && !seriesId && (
                  <Button variant="brand" size="sm" onClick={createSeries}>
                    <Check className="size-3.5" /> 组成剧集
                  </Button>
                )}
                {seriesId && <Badge variant="muted" className="text-emerald-500"><Check className="size-3" /> 已加入剧集</Badge>}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={addFrame}><Plus className="size-3.5" /> 添加帧</Button>
              </div>

              <div className="space-y-3">
                {frames.map((frame, i) => (
                  <div key={frame.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                      <span className="text-xs text-muted-foreground font-medium">#{i + 1}</span>
                      <button onClick={() => moveFrame(frame.id, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="size-3" /></button>
                      <button onClick={() => moveFrame(frame.id, 1)} disabled={i === frames.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="size-3" /></button>
                      <select className="text-[11px] border rounded px-1 py-0.5 bg-transparent" value={frame.shotSize} onChange={e => updateFrame(frame.id, { shotSize: e.target.value })}>{SHOT_SIZES.map(s => <option key={s}>{s}</option>)}</select>
                      <select className="text-[11px] border rounded px-1 py-0.5 bg-transparent" value={frame.cameraAngle} onChange={e => updateFrame(frame.id, { cameraAngle: e.target.value })}>{CAMERA_ANGLES.map(s => <option key={s}>{s}</option>)}</select>
                      <select className="text-[11px] border rounded px-1 py-0.5 bg-transparent" value={frame.cameraMovement} onChange={e => updateFrame(frame.id, { cameraMovement: e.target.value })}>{CAMERA_MOVEMENTS.map(s => <option key={s}>{s}</option>)}</select>
                      <div className="flex-1" />
                      <Button variant="ghost" size="icon-sm" onClick={() => generateFrame(frame.id)} disabled={frame.status === "running"} title="生图">
                        {frame.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-brand-500" />}
                      </Button>
                      {frame.imageUrl && (
                        <Button variant="ghost" size="icon-sm" onClick={() => generateVideo(frame.id)} disabled={frame.status === "running"} title="生视频"><Play className="size-3.5 text-brand-500" /></Button>
                      )}
                      <Button variant="ghost" size="icon-sm" onClick={() => deleteFrame(frame.id)}><Trash2 className="size-3.5 text-muted-foreground" /></Button>
                    </div>
                    <div className="grid grid-cols-[200px_200px_1fr] gap-3 p-3">
                      {/* Image */}
                      <div className="aspect-square rounded-lg bg-secondary overflow-hidden cursor-pointer" onClick={() => frame.imageUrl && setPreviewUrl(frame.imageUrl)}>
                        {frame.imageUrl ? <img src={frame.imageUrl} className="h-full w-full object-cover" /> :
                          frame.status === "running" ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> :
                          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">待生成</div>}
                      </div>
                      {/* Video */}
                      <div className="aspect-square rounded-lg bg-secondary overflow-hidden cursor-pointer group/v" onClick={() => frame.videoUrl && setPreviewUrl(frame.videoUrl)}>
                        {frame.videoUrl ? (
                          <>
                            <img src={frame.videoUrl} className="h-full w-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/v:bg-black/30 transition-colors"><Play className="size-8 text-white opacity-0 group-hover/v:opacity-100" /></div>
                          </>
                        ) : frame.status === "running" ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> :
                          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{frame.imageUrl ? "点 ▶ 生视频" : "待生图"}</div>}
                      </div>
                      {/* Description */}
                      <div className="space-y-2">
                        <Textarea placeholder="镜头描述…" value={frame.shotDescription} onChange={e => updateFrame(frame.id, { shotDescription: e.target.value })} className="min-h-14 text-xs resize-none" />
                        <div className="flex gap-1">
                          <Input placeholder="角色" value={frame.speaker} onChange={e => updateFrame(frame.id, { speaker: e.target.value })} className="h-6 text-[11px] w-16" />
                          <Input placeholder="对白" value={frame.dialogue} onChange={e => updateFrame(frame.id, { dialogue: e.target.value })} className="h-6 text-[11px] flex-1" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Next step banners */}
              {allImagesDone && !allVideosDone && (
                <div className="rounded-xl border border-brand-400/30 bg-brand-500/5 p-4 flex items-center justify-between">
                  <div><div className="font-medium text-sm">分镜图已全部生成</div><div className="text-xs text-muted-foreground">继续生成每帧的视频</div></div>
                  <Button variant="brand" size="sm" onClick={generateAllVideos}><Play className="size-3.5" /> 全部生视频</Button>
                </div>
              )}
              {allVideosDone && !seriesId && (
                <div className="rounded-xl border border-brand-400/30 bg-brand-500/5 p-4 flex items-center justify-between">
                  <div><div className="font-medium text-sm">全部分镜视频已完成</div><div className="text-xs text-muted-foreground">创建剧集，统一管理导出</div></div>
                  <Button variant="brand" onClick={createSeries}><Check className="size-4" /> 组成剧集</Button>
                </div>
              )}
              {seriesId && (
                <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/5 p-4 text-center">
                  <Check className="size-6 text-emerald-500 mx-auto mb-1" />
                  <div className="font-medium text-sm">流程完成！</div>
                  <div className="text-xs text-muted-foreground">剧集已创建，去剧集页管理导出</div>
                </div>
              )}
            </motion.section>
          )}
        </div>
      </div>

      {/* Preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-4xl p-1 bg-black/95">
          {previewUrl && <img src={previewUrl} className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Cell({ icon: Icon, label, count, color, children }: {
  icon: React.ComponentType<{ className?: string }>; label: string; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2"><Icon className={cn("size-4", color)} /><span className="text-sm font-medium">{label}</span><Badge variant="muted" className="text-[10px]">{count}</Badge></div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
