"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Sparkles, Trash2, User, ZoomIn, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as charactersApi from "@/lib/api/characters";
import type { CharacterAsset } from "@/lib/api/characters";
import type { Subject } from "@/lib/types";

const KIND_META: Record<string, { label: string; icon: typeof User; desc: string }> = {
  full_body: { label: "全身像", icon: User, desc: "角色全身站立姿态" },
  three_views: { label: "三视图", icon: RefreshCw, desc: "正面/侧面/背面" },
  headshot: { label: "头像特写", icon: ZoomIn, desc: "肩部以上面部细节" },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: Subject | null;
}

export function CharacterWorkbench({ open, onOpenChange, subject }: Props) {
  const [assets, setAssets] = React.useState<CharacterAsset[]>([]);
  const [generating, setGenerating] = React.useState(false);

  // Load assets when subject changes
  React.useEffect(() => {
    if (!subject || !open) return;
    void (async () => {
      try {
        const list = await charactersApi.listAssets(subject.id);
        setAssets(list);
      } catch { /* noop */ }
    })();
  }, [subject, open]);

  const handleGenerate = async (kinds: Array<"full_body" | "three_views" | "headshot">) => {
    if (!subject || generating) return;
    setGenerating(true);
    try {
      const result = await charactersApi.generateAssets(subject.id, kinds);
      toast.success(`已开始生成 ${result.assets.length} 个资源`);
      // Poll for updates
      pollAssets(subject.id);
    } catch (e) {
      toast.error((e as Error).message || "生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const pollAssets = async (subjectId: string) => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const list = await charactersApi.listAssets(subjectId);
        setAssets(list);
        if (list.every((a) => a.status === "succeeded" || a.status === "failed")) break;
      } catch { break; }
    }
  };

  const handleDelete = async (assetId: string) => {
    if (!subject) return;
    try {
      await charactersApi.deleteAsset(subject.id, assetId);
      setAssets((a) => a.filter((x) => x.id !== assetId));
    } catch (e) {
      toast.error("删除失败");
    }
  };

  const getAssetByKind = (kind: string) => assets.filter((a) => a.kind === kind);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{subject?.name || "角色"} — 角色工作台</DialogTitle>
          <DialogDescription>生成全身像、三视图和头像特写，保持角色一致性</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {(["full_body", "three_views", "headshot"] as const).map((kind) => {
            const kindAssets = getAssetByKind(kind);
            const latest = kindAssets[0];
            const meta = KIND_META[kind];

            return (
              <div key={kind} className="rounded-xl border border-border bg-card/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <meta.icon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-[11px] text-muted-foreground">{meta.desc}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={generating || latest?.status === "running"}
                    onClick={() => handleGenerate([kind])}
                  >
                    {latest?.status === "running" ? (
                      <><Loader2 className="size-3 animate-spin" /> 生成中</>
                    ) : latest?.status === "succeeded" ? (
                      <><RefreshCw className="size-3" /> 重新生成</>
                    ) : (
                      <><Sparkles className="size-3" /> 生成</>
                    )}
                  </Button>
                </div>

                {/* Result */}
                {latest?.status === "running" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex h-32 items-center justify-center rounded-lg bg-muted"
                  >
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </motion.div>
                )}
                {latest?.status === "succeeded" && latest.imageUrl && (
                  <div className="relative group">
                    <img
                      src={latest.imageUrl}
                      alt={`${subject?.name} - ${meta.label}`}
                      className="w-full rounded-lg object-cover max-h-48"
                    />
                    <button
                      onClick={() => handleDelete(latest.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
                {latest?.status === "failed" && (
                  <div className="flex h-24 items-center justify-center rounded-lg bg-destructive/10 text-sm text-destructive">
                    {latest.errorMessage || "生成失败"}
                  </div>
                )}
                {!latest && (
                  <div className="flex h-24 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
                    点击生成按钮创建
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button
            variant="brand"
            size="sm"
            className="flex-1"
            disabled={generating}
            onClick={() => handleGenerate(["full_body", "three_views", "headshot"])}
          >
            <Sparkles className="size-3.5" />
            一键全部生成
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
