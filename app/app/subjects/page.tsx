"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Sparkles, Pencil, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubjectManager } from "@/components/workspace/subject-manager";
import { CharacterWorkbench } from "@/components/workspace/character-workbench";
import { useAuthStore } from "@/lib/store/auth-store";
import * as subjectsApi from "@/lib/api/subjects";
import { formatRelativeTime } from "@/lib/utils";
import type { Subject } from "@/lib/types";

export default function SubjectsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [subjects, setSubjects] = React.useState<Subject[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [workbenchSubject, setWorkbenchSubject] = React.useState<Subject | null>(null);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    subjectsApi.listMine(user.id).then((list) => {
      if (cancelled) return;
      setSubjects(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const onDelete = async (s: Subject) => {
    await subjectsApi.remove(s.id);
    toast.success(`已删除：${s.name}`);
    reload();
  };

  const filtered = subjects.filter(
    (s) => s.name.toLowerCase().includes(q.toLowerCase()) ||
           s.description.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">主体库</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            给反复出现的角色、场景、物品起个名字。在创作中输入 <span className="font-mono text-foreground">@</span> 直接引用。
          </p>
        </div>
        <Button variant="brand" onClick={() => setManagerOpen(true)}>
          <Plus className="size-4" />
          新建主体
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索名字或描述"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} 个主体</span>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="grain flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-1 p-16 text-center">
          <div className="font-display text-xl tracking-tight">
            {subjects.length === 0 ? "还没有主体" : "没有匹配的主体"}
          </div>
          <p className="mt-2 max-w-md text-xs text-muted-foreground">
            创建第一个主体，在文生图里 @ 引用就能复用。
          </p>
          {subjects.length === 0 && (
            <Button variant="brand" size="sm" className="mt-5" onClick={() => setManagerOpen(true)}>
              <Plus className="size-4" />
              新建第一个
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-brand-400/40"
            >
              <div className="flex gap-3 p-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-secondary">
                  {s.imageUrl ? (
                    <img src={s.imageUrl} alt={s.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">无图</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">@{s.name}</span>
                    {s.tags.slice(0, 2).map((t) => (
                      <Badge key={t} variant="muted" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                    {s.description || "（暂无描述）"}
                  </p>
                  <div className="mt-2 text-[11px] text-muted-foreground">{formatRelativeTime(s.updatedAt)}</div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 border-t border-border bg-surface-2 px-3 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    router.push(`/app/text-to-image`);
                    toast.message(`在文生图中输入 @${s.name} 即可引用`);
                  }}
                >
                  <Sparkles className="size-3.5" />
                  去创作
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setWorkbenchSubject(s)}
                >
                  <User className="size-3.5" />
                  角色工作台
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setManagerOpen(true)} title="编辑">
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onDelete(s)} title="删除">
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SubjectManager open={managerOpen} onOpenChange={setManagerOpen} onChange={reload} />
      <CharacterWorkbench
        open={!!workbenchSubject}
        onOpenChange={(v) => { if (!v) setWorkbenchSubject(null); }}
        subject={workbenchSubject}
      />
    </div>
  );
}
