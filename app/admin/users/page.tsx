"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import * as adminApi from "@/lib/api/admin";
import { formatRelativeTime } from "@/lib/utils";
import { useAuthStore } from "@/lib/store/auth-store";
import type { User } from "@/lib/types";

export default function UsersPage() {
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = React.useState<User[]>([]);
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    adminApi.listUsers().then((list) => {
      if (cancelled) return;
      setUsers(list);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const filtered = users.filter((u) => u.username.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-8">
        <h1 className="font-display text-3xl tracking-tight">用户管理</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          调整用户角色与启用状态。停用的用户无法登录。
        </p>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索用户名"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} 个用户</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-4 border-b border-border bg-surface-2 px-5 py-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          <div>用户</div>
          <div>注册时间</div>
          <div>状态</div>
          <div>角色</div>
          <div>启用</div>
        </div>

        {loading ? (
          <div className="space-y-px">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-secondary/50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">没有匹配的用户</div>
        ) : (
          filtered.map((u) => (
            <UserRow key={u.id} u={u} isMe={u.id === me?.id} onChange={reload} />
          ))
        )}
      </div>
    </div>
  );
}

function UserRow({
  u, isMe, onChange,
}: { u: User; isMe: boolean; onChange: () => void }) {
  const enabled = u.status === "active";

  const toggleEnabled = async (v: boolean) => {
    await adminApi.updateUserStatus(u.id, v ? "active" : "disabled");
    toast.success(v ? "已启用" : "已停用");
    onChange();
  };

  const changeRole = async (v: string) => {
    await adminApi.updateUserRole(u.id, v as User["role"]);
    toast.success(`角色已更新为${v === "admin" ? "管理员" : "普通用户"}`);
    onChange();
  };

  return (
    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] items-center gap-4 border-b border-border/60 px-5 py-3 last:border-0 hover:bg-secondary/30">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="size-8">
          <AvatarFallback className="text-[11px]">{u.username.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {u.username}
            {isMe && <Badge variant="muted" className="text-[10px]">你</Badge>}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">{u.id}</div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">{formatRelativeTime(u.createdAt)}</div>
      <div>
        <StatusBadge status={u.status} />
      </div>
      <div>
        <Select value={u.role} onValueChange={changeRole} disabled={isMe}>
          <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user">普通用户</SelectItem>
            <SelectItem value="admin">管理员</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={toggleEnabled} disabled={isMe} />
        <span className="text-xs text-muted-foreground">{enabled ? "启用" : "停用"}</span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: User["status"] }) {
  if (status === "active") return <Badge variant="success">活跃</Badge>;
  if (status === "pending") return <Badge variant="brand">待审核</Badge>;
  if (status === "rejected") return <Badge variant="danger">已驳回</Badge>;
  return <Badge variant="muted">已停用</Badge>;
}
