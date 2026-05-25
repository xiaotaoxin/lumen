"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart, RefreshCw, Trash2, Filter, ImageIcon, Clapperboard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/store/auth-store";
import * as historyApi from "@/lib/api/history";
import { findModel, MODELS } from "@/lib/catalog";
import { formatRelativeTime } from "@/lib/utils";
import type { Generation, ModelKind } from "@/lib/types";

export default function HistoryPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [items, setItems] = React.useState<Generation[]>([]);
  const [kind, setKind] = React.useState<"all" | ModelKind>("all");
  const [modelId, setModelId] = React.useState<string>("all");
  const [favOnly, setFavOnly] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const [reloadKey, setReloadKey] = React.useState(0);
  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    historyApi
      .listMine(user.id, {
        kind: kind === "all" ? undefined : kind,
        modelId: modelId === "all" ? undefined : modelId,
        favorite: favOnly || undefined,
      })
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user, kind, modelId, favOnly, reloadKey]);

  const remove = async (g: Generation) => {
    await historyApi.remove(g.id);
    toast.success("已删除");
    reload();
  };

  const fav = async (g: Generation) => {
    await historyApi.toggleFavorite(g.id);
    reload();
  };

  const rerun = (g: Generation) => {
    if (g.kind === "image") router.push("/app/text-to-image");
    else router.push("/app/image-to-video");
    toast.message("已跳转，请在工作台中按需调整后重跑", { duration: 3500 });
  };

  return (
    <div className="mx-auto max-w-screen-xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">我的作品</h1>
          <p className="mt-2 text-sm text-muted-foreground">所有生成都自动入库，按时间倒序。</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <Filter className="size-4 text-muted-foreground" />
        <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="image">图像</TabsTrigger>
            <TabsTrigger value="video">视频</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={modelId} onValueChange={setModelId}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有模型</SelectItem>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={favOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setFavOnly((v) => !v)}
        >
          <Heart className={`size-4 ${favOnly ? "fill-current" : ""}`} />
          仅看收藏
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          共 {items.length} 条
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="grain flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-1 p-16 text-center">
          <div className="font-display text-xl tracking-tight">暂时还没有作品</div>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            去文生图或图生视频生成第一条吧。
          </p>
          <div className="mt-6 flex gap-2">
            <Button variant="brand" onClick={() => router.push("/app/text-to-image")}>开始文生图</Button>
            <Button variant="outline" onClick={() => router.push("/app/image-to-video")}>开始图生视频</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((g) => (
            <HistoryCard key={g.id} g={g} onFavorite={fav} onRemove={remove} onRerun={rerun} />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryCard({
  g, onFavorite, onRemove, onRerun,
}: {
  g: Generation;
  onFavorite: (g: Generation) => void;
  onRemove: (g: Generation) => void;
  onRerun: (g: Generation) => void;
}) {
  const model = findModel(g.modelId);
  const failed = g.status === "failed";
  const succeeded = g.status === "succeeded";
  // 图：直接用 imageUrls[0]
  // 视频：优先 videoPosterUrl；没 poster 就用 video 自己取首帧（DashScope wan2.7 不返回 poster）
  const imageCover = g.kind === "image" ? g.imageUrls?.[0] : null;
  const videoCover = g.kind === "video" ? g.videoPosterUrl : null;
  const videoSrc = g.kind === "video" ? g.videoUrl : null;
  const [videoExpired, setVideoExpired] = React.useState(false);

  const hasAnyCover = imageCover || videoCover || (videoSrc && !videoExpired);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-brand-400/30">
      <div className="relative aspect-square overflow-hidden bg-secondary">
        {imageCover ? (
          <img src={imageCover} alt={g.prompt} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : videoCover ? (
          <img src={videoCover} alt={g.prompt} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : videoSrc && !videoExpired ? (
          // 浏览器原生取首帧作为预览
          <video
            src={videoSrc}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
            onError={() => setVideoExpired(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            {g.kind === "image" ? <ImageIcon className="size-6" /> : <Clapperboard className="size-6" />}
            {failed ? "生成失败"
              : (g.kind === "video" && succeeded && videoExpired) ? "视频链接已过期"
              : (g.kind === "video" && succeeded) ? "无封面（视频可下载）"
              : "未生成"}
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <Badge variant={g.kind === "image" ? "brand" : "muted"} className="text-[10px]">
            {g.kind === "image" ? "图" : "视频"}
          </Badge>
          {failed && <Badge variant="danger" className="text-[10px]">失败</Badge>}
          {g.kind === "video" && succeeded && videoExpired && (
            <Badge variant="warning" className="text-[10px]">链接过期</Badge>
          )}
        </div>
        {g.kind === "video" && hasAnyCover && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-md">
              <Clapperboard className="size-5 text-white" />
            </div>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onFavorite(g)}
            className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
            title="收藏"
          >
            <Heart className={`size-4 ${g.favorite ? "fill-brand-300 text-brand-300" : ""}`} />
          </button>
          <button
            onClick={() => onRerun(g)}
            className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
            title="再来一张"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={() => onRemove(g)}
            className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md hover:bg-white/20"
            title="删除"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-xs leading-snug">{g.prompt}</p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="truncate">{model?.name}</span>
          <span>{formatRelativeTime(g.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
