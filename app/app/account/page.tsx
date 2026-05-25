"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/lib/store/auth-store";
import * as historyApi from "@/lib/api/history";

export default function AccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [stats, setStats] = React.useState({ total: 0, image: 0, video: 0, favorites: 0, credits: 0 });

  React.useEffect(() => {
    if (!user) return;
    historyApi.listMine(user.id).then((list) => {
      setStats({
        total: list.length,
        image: list.filter((g) => g.kind === "image").length,
        video: list.filter((g) => g.kind === "video").length,
        favorites: list.filter((g) => g.favorite).length,
        credits: list.reduce((s, g) => s + (g.cost ?? 0), 0),
      });
    });
  }, [user]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-8 font-display text-3xl tracking-tight">账号设置</h1>

      <Card className="mb-6">
        <CardContent className="flex items-center gap-5 p-6">
          <Avatar className="size-16 border border-border">
            <AvatarFallback className="text-base">{user.username.slice(0, 2)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-display text-xl">{user.username}</span>
              <Badge variant={user.role === "admin" ? "brand" : "muted"}>
                {user.role === "admin" ? "管理员" : "用户"}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">账号 ID · <span className="font-mono">{user.id}</span></div>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await logout();
              router.push("/");
            }}
          >
            <LogOut className="size-4" />
            退出登录
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>使用概览</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 md:grid-cols-5">
          <Stat label="总生成数" value={String(stats.total)} />
          <Stat label="图像" value={String(stats.image)} />
          <Stat label="视频" value={String(stats.video)} />
          <Stat label="收藏" value={String(stats.favorites)} />
          <Stat label="累计消耗" value={`${stats.credits} cr`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>外观</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ThemeBtn current={theme} value="light" label="浅色" icon={<Sun className="size-4" />} onChange={setTheme} />
            <ThemeBtn current={theme} value="dark" label="深色" icon={<Moon className="size-4" />} onChange={setTheme} />
            <ThemeBtn current={theme} value="system" label="跟随系统" icon={<Monitor className="size-4" />} onChange={setTheme} />
          </div>
          <p className="text-xs text-muted-foreground">主题选择会保存在本地浏览器。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-2xl tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function ThemeBtn({
  current, value, label, icon, onChange,
}: {
  current?: string;
  value: string;
  label: string;
  icon: React.ReactNode;
  onChange: (v: string) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-brand-400/60 bg-brand-500/5 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

