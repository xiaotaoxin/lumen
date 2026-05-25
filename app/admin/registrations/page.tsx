"use client";

import * as React from "react";
import { Check, Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as adminApi from "@/lib/api/admin";
import { useAuthStore } from "@/lib/store/auth-store";
import { formatRelativeTime } from "@/lib/utils";
import type { RegistrationApplication } from "@/lib/types";

export default function RegistrationsPage() {
  const me = useAuthStore((s) => s.user);
  const [items, setItems] = React.useState<RegistrationApplication[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [tab, setTab] = React.useState<"pending" | "history">("pending");
  const [rejecting, setRejecting] = React.useState<RegistrationApplication | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    adminApi.listApplications().then((list) => {
      if (cancelled) return;
      setItems(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const pending = items.filter((a) => a.status === "pending");
  const history = items.filter((a) => a.status !== "pending");
  const list = tab === "pending" ? pending : history;

  const approve = async (a: RegistrationApplication) => {
    setBusy(a.id);
    try {
      await adminApi.approveApplication(a.id, me?.username ?? "admin");
      toast.success(`已通过：${a.username}`);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await adminApi.rejectApplication(rejecting.id, me?.username ?? "admin", reason || "未通过");
      toast.success(`已驳回：${rejecting.username}`);
      setRejecting(null);
      setReason("");
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">注册审核</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            通过后用户即可登录使用全部功能。驳回不会真正删除账号，只是不允许登录。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="brand">
            <Clock className="size-3" />
            待审核 {pending.length}
          </Badge>
        </div>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-secondary p-1 w-fit">
        <button
          onClick={() => setTab("pending")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "pending" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          待审核（{pending.length}）
        </button>
        <button
          onClick={() => setTab("history")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "history" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          历史记录（{history.length}）
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <ApplicationRow
              key={a.id}
              a={a}
              busy={busy === a.id}
              onApprove={() => approve(a)}
              onReject={() => setRejecting(a)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>驳回 {rejecting?.username} 的注册申请</DialogTitle>
            <DialogDescription>
              简要说明原因。用户在重新申请时可以看到这个原因。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">原因</Label>
            <Input
              id="reason"
              placeholder="例如：账号疑似自动注册"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejecting(null); setReason(""); }}>取消</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={busy === rejecting?.id}>
              {busy === rejecting?.id && <Loader2 className="size-4 animate-spin" />}
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplicationRow({
  a, busy, onApprove, onReject,
}: {
  a: RegistrationApplication;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isPending = a.status === "pending";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
      <Avatar className="size-11">
        <AvatarFallback>{a.username.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{a.username}</span>
          {a.status === "approved" && <Badge variant="success"><Check className="size-3" /> 已通过</Badge>}
          {a.status === "rejected" && <Badge variant="danger"><X className="size-3" /> 已驳回</Badge>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          提交于 {formatRelativeTime(a.submittedAt)}
          {a.reviewedAt && ` · 审核于 ${formatRelativeTime(a.reviewedAt)}`}
          {a.reviewedBy && ` · 审核人 ${a.reviewedBy}`}
        </div>
        {a.rejectedReason && (
          <div className="mt-1 text-xs text-destructive">驳回原因：{a.rejectedReason}</div>
        )}
      </div>
      {isPending && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReject} disabled={busy}>
            <X className="size-4" />
            驳回
          </Button>
          <Button variant="brand" size="sm" onClick={onApprove} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            通过
          </Button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: "pending" | "history" }) {
  return (
    <div className="grain flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-1 p-16 text-center">
      <div className="font-display text-xl tracking-tight">
        {tab === "pending" ? "暂无待审核的申请" : "还没有审核记录"}
      </div>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {tab === "pending" ? "新的注册申请会出现在这里。" : "审核完成的申请会归档到这里。"}
      </p>
    </div>
  );
}
