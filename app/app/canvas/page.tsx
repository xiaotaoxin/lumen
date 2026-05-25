"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, Trash2, Frame, Workflow, ImagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/store/auth-store";
import * as canvasesApi from "@/lib/api/canvases";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { CanvasDoc, CanvasKind } from "@/lib/types";

export default function CanvasListPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [items, setItems] = React.useState<CanvasDoc[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [pickerOpen, setPickerOpen] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    canvasesApi.listMine(user.id).then((list) => {
      if (cancelled) return;
      setItems(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, reloadKey]);

  const createWith = async (kind: CanvasKind) => {
    if (!user) return;
    setPickerOpen(false);
    const doc = await canvasesApi.create(user.id, { kind });
    router.push(`/app/canvas/${doc.id}`);
  };

  const remove = async (c: CanvasDoc) => {
    await canvasesApi.remove(c.id);
    toast.success("已删除");
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">画布</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            两种画布形态：节点流串联生成、自由画布作为创作素材的灵感板
          </p>
        </div>
        <Button variant="brand" onClick={() => setPickerOpen(true)}>
          <Plus className="size-4" />
          新建画布
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="grain flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-1 p-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/20 to-aurora-400/20">
            <Frame className="size-6 text-brand-400" />
          </div>
          <div className="font-display text-xl tracking-tight">还没有画布</div>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            画布是一张可以无限延伸的纸 —— 「节点流」用来串联生成工作流，「自由画布」用来收集和拼贴灵感素材。
          </p>
          <Button variant="brand" className="mt-6" onClick={() => setPickerOpen(true)}>
            <Plus className="size-4" />
            新建第一张画布
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <CanvasCard key={c.id} c={c} onDelete={remove} />
          ))}
        </div>
      )}

      <CanvasTypePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={createWith}
      />
    </div>
  );
}

function CanvasCard({
  c, onDelete,
}: { c: CanvasDoc; onDelete: (c: CanvasDoc) => void }) {
  const isFlow = c.kind === "flow";
  return (
    <Link
      href={`/app/canvas/${c.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-brand-400/40"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        {c.coverUrl ? (
          <img src={c.coverUrl} alt={c.title} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="aurora-bg flex h-full w-full items-center justify-center">
            {isFlow ? (
              <Workflow className="size-8 text-brand-400/60" />
            ) : (
              <ImagePlus className="size-8 text-aurora-400/60" />
            )}
          </div>
        )}
        <Badge
          variant={isFlow ? "brand" : "muted"}
          className="absolute left-2 top-2 text-[10px]"
        >
          {isFlow ? "节点流" : "自由画布"}
        </Badge>
      </div>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {c.nodes.length} 个{isFlow ? "节点" : "素材"} · {formatRelativeTime(c.updatedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(c); }}
          className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          aria-label="删除"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </Link>
  );
}

function CanvasTypePickerDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (kind: CanvasKind) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择画布类型</DialogTitle>
          <DialogDescription>
            两种画布解决不同问题：节点流偏工作流，自由画布偏素材拼贴
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PickerCard
            kind="flow"
            icon={<Workflow className="size-6 text-brand-400" />}
            title="节点流画布"
            desc="把生成节点串成工作流：图像 → 视频，多重变体并行；连线触发自动生成。"
            features={["图像 / 视频生成节点", "节点连线", "上方变体工具栏", "模板：文生图 / 图生视频 / 文字生视频"]}
            accent="brand"
            onClick={() => onPick("flow")}
          />
          <PickerCard
            kind="freeform"
            icon={<ImagePlus className="size-6 text-aurora-400" />}
            title="自由画布"
            desc="作为创作素材的灵感板：上传 / 拖入 / 粘贴图片视频，自由摆放和分组。"
            features={["上传本地图片 / 视频", "Ctrl+V 粘贴截图", "拖拽外部文件", "自由摆放，无连线限制"]}
            accent="aurora"
            onClick={() => onPick("freeform")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PickerCard({
  icon, title, desc, features, accent, onClick,
}: {
  kind: CanvasKind;
  icon: React.ReactNode;
  title: string;
  desc: string;
  features: string[];
  accent: "brand" | "aurora";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition-all",
        accent === "brand"
          ? "border-border hover:border-brand-400/60 hover:bg-brand-500/5"
          : "border-border hover:border-aurora-400/60 hover:bg-aurora-400/5",
      )}
    >
      <div className={cn(
        "flex size-12 items-center justify-center rounded-xl",
        accent === "brand" ? "bg-brand-500/10" : "bg-aurora-400/10",
      )}>
        {icon}
      </div>
      <div className="font-display text-lg tracking-tight">{title}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-1.5">
            <span className={cn(
              "mt-1 size-1 shrink-0 rounded-full",
              accent === "brand" ? "bg-brand-500" : "bg-aurora-400",
            )} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
