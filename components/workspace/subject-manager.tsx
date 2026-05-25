"use client";

import * as React from "react";
import { ImagePlus, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import * as subjectsApi from "@/lib/api/subjects";
import { useAuthStore } from "@/lib/store/auth-store";
import type { Subject } from "@/lib/types";
import { LumenApiError } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

const PRESET_TAGS = ["角色", "场景", "物品", "氛围", "原创", "IP"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notified whenever the subjects list mutates so the parent can refresh. */
  onChange?: () => void;
}

export function SubjectManager({ open, onOpenChange, onChange }: Props) {
  const user = useAuthStore((s) => s.user);
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editing, setEditing] = React.useState<Subject | "new" | null>(null);
  const [q, setQ] = React.useState("");

  const reload = React.useCallback(() => {
    setReloadKey((k) => k + 1);
    onChange?.();
  }, [onChange]);

  React.useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    subjectsApi.listMine(user.id).then((list) => {
      if (cancelled) return;
      setSubjects(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, user, reloadKey]);

  const filtered = subjects.filter(
    (s) => s.name.toLowerCase().includes(q.toLowerCase()) ||
           s.description.toLowerCase().includes(q.toLowerCase()),
  );

  const onDelete = async (s: Subject) => {
    await subjectsApi.remove(s.id);
    toast.success(`已删除：${s.name}`);
    reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        {editing ? (
          <SubjectEditor
            subject={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); reload(); }}
          />
        ) : (
          <>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>我的主体</DialogTitle>
              <DialogDescription>
                给反复出现的角色、场景、物品起个名字，写好描述。在文生图里 <span className="font-mono text-foreground">@名字</span> 就能引用。
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索名字或描述"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Button variant="brand" size="sm" onClick={() => setEditing("new")}>
                <Plus className="size-4" />
                新建主体
              </Button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState onCreate={() => setEditing("new")} hasAny={subjects.length > 0} />
              ) : (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  {filtered.map((s) => (
                    <SubjectCard
                      key={s.id}
                      s={s}
                      onEdit={() => setEditing(s)}
                      onDelete={() => onDelete(s)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubjectCard({
  s, onEdit, onDelete,
}: { s: Subject; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="group flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-brand-400/40">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {s.imageUrl ? (
          <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            无图
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">@{s.name}</span>
          {s.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="muted" className="text-[10px]">{t}</Badge>
          ))}
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {s.description || "（暂无描述）"}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">{formatRelativeTime(s.updatedAt)}</div>
      </div>
      <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} title="编辑">
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} title="删除">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, hasAny }: { onCreate: () => void; hasAny: boolean }) {
  return (
    <div className="grain flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1 px-6 py-16 text-center">
      <div className="font-display text-lg tracking-tight">
        {hasAny ? "没有匹配的主体" : "还没有主体"}
      </div>
      <p className="mt-2 max-w-sm text-xs text-muted-foreground">
        给一个反复出现的角色、场景或物品起个名字，写好描述，下一次直接 @ 引用就行。
      </p>
      {!hasAny && (
        <Button variant="brand" size="sm" className="mt-5" onClick={onCreate}>
          <Plus className="size-4" />
          新建第一个主体
        </Button>
      )}
    </div>
  );
}

function SubjectEditor({
  subject, onCancel, onSaved,
}: {
  subject: Subject | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = React.useState(subject?.name ?? "");
  const [description, setDescription] = React.useState(subject?.description ?? "");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = React.useState(subject?.imageUrl);
  const [tags, setTags] = React.useState<string[]>(subject?.tags ?? []);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const onPickFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("参考图不能大于 10MB");
      return;
    }
    setUploading(true);
    try {
      // Convert to base64 then upload to server to get a stable URL
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";
      const token = (await import("@/lib/api/client")).getToken();
      const res = await fetch(`${BACKEND}/files/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          dataUrl,
          filename: `subject-${Date.now()}.${file.name.split(".").pop() || "png"}`,
        }),
      });
      if (!res.ok) throw new Error("上传失败");
      const data = await res.json() as { url: string };
      setImageUrl(data.url);
    } catch (e) {
      toast.error((e as Error).message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const toggleTag = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const onSubmit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      if (subject) {
        await subjectsApi.update(subject.id, { name, description, imageUrl, tags });
        toast.success("已更新");
      } else {
        await subjectsApi.create(user.id, { name, description, imageUrl, tags });
        toast.success("已创建");
      }
      onSaved();
    } catch (e) {
      if (e instanceof LumenApiError) toast.error(e.message);
      else toast.error("保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <DialogHeader className="px-6 pt-6 pb-4">
        <DialogTitle>{subject ? `编辑：@${subject.name}` : "新建主体"}</DialogTitle>
        <DialogDescription>
          描述会在生成时自动追加到提示词里。建议写清楚视觉特征（外貌 / 服饰 / 风格 / 配色…）。
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[160px_1fr] gap-6 px-6 py-2">
        <div className="space-y-2">
          <Label>参考图</Label>
          {imageUrl ? (
            <div className="group relative aspect-square overflow-hidden rounded-xl border border-border">
              <img src={imageUrl} alt="reference" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setImageUrl(undefined)}
                className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex aspect-square w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card transition-colors",
                  uploading ? "opacity-50" : "hover:border-brand-400/40",
                )}
              >
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  <ImagePlus className="size-5 text-muted-foreground" />
                )}
                <div className="text-[11px] text-muted-foreground">{uploading ? "上传中…" : "上传图片"}</div>
                <div className="text-[10px] text-muted-foreground/70">PNG/JPG ≤ 10MB</div>
              </button>
            </>
          )}
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subj-name">名字（@ 提及时使用）</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground font-mono text-sm">@</span>
              <Input
                id="subj-name"
                placeholder="例如：Lina"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-mono"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">不要含空格；1–24 个字符；同账号不可重名。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subj-desc">描述</Label>
            <Textarea
              id="subj-desc"
              rows={5}
              placeholder="例如：短发亚裔少女，淡灰色风衣，左眼下有一颗小痣"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-28 text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>标签</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      on
                        ? "border-brand-400/60 bg-brand-500/10 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-1 px-6 py-4">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>取消</Button>
        <Button variant="brand" onClick={onSubmit} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {subject ? "保存修改" : "创建主体"}
        </Button>
      </div>
    </div>
  );
}
