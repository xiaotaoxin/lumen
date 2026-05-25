"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Clapperboard, Plus, Trash2, Sparkles, Loader2, Play, Camera,
  ChevronUp, ChevronDown, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/store/auth-store";
import * as sbApi from "@/lib/api/storyboards";
import type { Storyboard, StoryboardFrame } from "@/lib/api/storyboards";

const SHOT_SIZES = ["远景", "全景", "中景", "近景", "特写", "大特写"];
const CAMERA_ANGLES = ["平视", "俯视", "仰视", "鸟瞰"];
const CAMERA_MOVEMENTS = ["固定", "慢推", "慢拉", "横移", "跟拍", "手持"];

export default function StoryboardsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [boards, setBoards] = React.useState<Storyboard[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeBoard, setActiveBoard] = React.useState<Storyboard | null>(null);
  const [frames, setFrames] = React.useState<StoryboardFrame[]>([]);

  const reloadBoards = React.useCallback(async () => {
    try { setBoards(await sbApi.list()); } catch { /* noop */ }
    setLoading(false);
  }, []);

  React.useEffect(() => { if (user) reloadBoards(); }, [user]);

  const openBoard = async (board: Storyboard) => {
    try {
      const full = await sbApi.get(board.id);
      setActiveBoard(full);
      setFrames(full.frames || []);
    } catch { toast.error("加载分镜失败"); }
  };

  const createBoard = async () => {
    try {
      const b = await sbApi.create({ title: "新分镜" });
      await reloadBoards();
      openBoard(b);
    } catch { toast.error("创建失败"); }
  };

  const addFrame = async () => {
    if (!activeBoard) return;
    try {
      const f = await sbApi.addFrame(activeBoard.id, {});
      setFrames(prev => [...prev, f]);
    } catch { toast.error("添加失败"); }
  };

  const updateFrame = async (frameId: string, patch: Partial<StoryboardFrame>) => {
    if (!activeBoard) return;
    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, ...patch } : f));
    try { await sbApi.updateFrame(activeBoard.id, frameId, patch); } catch { /* noop */ }
  };

  const deleteFrame = async (frameId: string) => {
    if (!activeBoard) return;
    setFrames(prev => prev.filter(f => f.id !== frameId));
    try { await sbApi.deleteFrame(activeBoard.id, frameId); } catch { /* noop */ }
  };

  const moveFrame = async (frameId: string, dir: -1 | 1) => {
    const idx = frames.findIndex(f => f.id === frameId);
    if (idx < 0 || (dir === -1 && idx === 0) || (dir === 1 && idx === frames.length - 1)) return;
    const next = [...frames];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    setFrames(next);
    try { await sbApi.reorderFrames(activeBoard!.id, next.map(f => f.id)); } catch { /* noop */ }
  };

  const generateVideo = async (frameId: string) => {
    if (!activeBoard) return;
    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, status: "running" } : f));
    try {
      const result = await sbApi.generateVideo(activeBoard.id, frameId);
      pollFrameResult(activeBoard.id, frameId);
    } catch (e) {
      setFrames(prev => prev.map(f => f.id === frameId ? { ...f, status: "failed", errorMessage: (e as Error).message } : f));
    }
  };

  const generateFrame = async (frameId: string) => {
    if (!activeBoard) return;
    setFrames(prev => prev.map(f => f.id === frameId ? { ...f, status: "running" } : f));
    try {
      // Build image prompt from frame details
      const frame = frames.find(f => f.id === frameId);
      if (frame) {
        const prompt = [frame.shotDescription, `${frame.shotSize}·${frame.cameraAngle}·${frame.cameraMovement}`].filter(Boolean).join("，");
        await sbApi.updateFrame(activeBoard.id, frameId, { imagePrompt: prompt });
      }
      const result = await sbApi.generateFrame(activeBoard.id, frameId);
      pollFrameResult(activeBoard.id, frameId);
    } catch (e) {
      setFrames(prev => prev.map(f => f.id === frameId ? { ...f, status: "failed", errorMessage: (e as Error).message } : f));
    }
  };

  const pollFrameResult = async (boardId: string, frameId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const full = await sbApi.get(boardId);
        const f = full.frames?.find(f => f.id === frameId);
        if (f && (f.status === "succeeded" || f.status === "failed")) {
          setFrames(prev => prev.map(p => p.id === frameId ? f : p));
          if (f.status === "succeeded") toast.success("分镜帧生成完成");
          break;
        }
      } catch { break; }
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

  if (activeBoard) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-border px-6 py-3">
          <Button variant="ghost" size="sm" onClick={() => { setActiveBoard(null); reloadBoards(); }}>← 返回</Button>
          <Input
            value={activeBoard.title}
            onChange={e => { setActiveBoard(prev => prev ? { ...prev, title: e.target.value } : null); }}
            className="h-8 w-48 font-medium"
          />
          <div className="flex-1" />
          <Badge variant="muted">{frames.length} 帧</Badge>
          <Button variant="outline" size="sm" onClick={generateAll} disabled={frames.length === 0 || frames.every(f => f.status !== "idle" && f.status !== "failed")}>
            <Sparkles className="size-3.5" /> 全部生图
          </Button>
          <Button variant="outline" size="sm" onClick={generateAllVideos} disabled={!frames.some(f => f.status === "succeeded" && f.imageUrl)}>
            <Play className="size-3.5" /> 全部生视频
          </Button>
          <Button variant="brand" size="sm" onClick={addFrame}>
            <Plus className="size-3.5" /> 添加帧
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-2xl space-y-4">
            {frames.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Camera className="size-10 mb-3" />
                <p className="text-sm">还没有分镜帧，点击"添加帧"开始</p>
              </div>
            ) : (
              frames.map((frame, i) => (
                <motion.div
                  key={frame.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-xl border border-border bg-card"
                >
                  {/* Frame header */}
                  <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                    <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                    <button onClick={() => moveFrame(frame.id, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
                    <button onClick={() => moveFrame(frame.id, 1)} disabled={i === frames.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
                    <div className="flex-1" />
                    <select className="text-xs border rounded px-1.5 py-0.5 bg-transparent" value={frame.shotSize} onChange={e => updateFrame(frame.id, { shotSize: e.target.value })}>
                      {SHOT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className="text-xs border rounded px-1.5 py-0.5 bg-transparent" value={frame.cameraAngle} onChange={e => updateFrame(frame.id, { cameraAngle: e.target.value })}>
                      {CAMERA_ANGLES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select className="text-xs border rounded px-1.5 py-0.5 bg-transparent" value={frame.cameraMovement} onChange={e => updateFrame(frame.id, { cameraMovement: e.target.value })}>
                      {CAMERA_MOVEMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <Button variant="ghost" size="icon-sm" onClick={() => generateFrame(frame.id)} disabled={frame.status === "running"} title="生成图片">
                      {frame.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-brand-500" />}
                    </Button>
                    {frame.status === "succeeded" && frame.imageUrl && (
                      <Button variant="ghost" size="icon-sm" onClick={() => generateVideo(frame.id)} title="图生视频">
                        <Play className="size-3.5 text-brand-500" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" onClick={() => deleteFrame(frame.id)}><Trash2 className="size-3.5 text-muted-foreground" /></Button>
                  </div>

                  {/* Frame body: image + description */}
                  <div className="grid grid-cols-[140px_1fr] gap-4 p-4">
                    <div className="aspect-square rounded-lg bg-secondary overflow-hidden">
                      {frame.imageUrl ? (
                        <img src={frame.imageUrl} alt={`Shot ${i + 1}`} className="h-full w-full object-cover" />
                      ) : frame.status === "running" ? (
                        <div className="flex h-full items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
                      ) : frame.status === "failed" ? (
                        <div className="flex h-full items-center justify-center text-xs text-destructive text-center p-2">{frame.errorMessage || "生成失败"}</div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">点击 ✨ 生成</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Textarea
                        placeholder="镜头描述（动作、表情、氛围…）"
                        value={frame.shotDescription}
                        onChange={e => updateFrame(frame.id, { shotDescription: e.target.value })}
                        className="min-h-16 text-sm resize-none"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="角色"
                          value={frame.speaker}
                          onChange={e => updateFrame(frame.id, { speaker: e.target.value })}
                          className="h-7 text-xs w-20"
                        />
                        <Input
                          placeholder="对白"
                          value={frame.dialogue}
                          onChange={e => updateFrame(frame.id, { dialogue: e.target.value })}
                          className="h-7 text-xs flex-1"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // Board list view
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">分镜编辑器</h1>
          <p className="mt-2 text-sm text-muted-foreground">规划镜头序列，逐帧生成参考图。</p>
        </div>
        <Button variant="brand" onClick={createBoard}><Plus className="size-4" /> 新建分镜</Button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : boards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-muted-foreground">
          <Camera className="size-10 mb-3" />
          <p className="text-sm">还没有分镜，创建第一个开始规划镜头</p>
          <Button variant="brand" size="sm" className="mt-4" onClick={createBoard}><Plus className="size-4" /> 新建分镜</Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {boards.map(b => (
            <div
              key={b.id}
              onClick={() => openBoard(b)}
              className="group cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-400/30"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{b.title}</span>
                <Badge variant="muted">{b.frameCount || 0} 帧</Badge>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                创建于 {new Date(b.createdAt).toLocaleDateString("zh-CN")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
