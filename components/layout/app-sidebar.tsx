"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Clapperboard,
  Film,
  History,
  ImageIcon,
  Plug,
  Settings,
  Users2,
  ShieldCheck,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store/auth-store";

const userItems = [
  { href: "/app/text-to-image", label: "文生图", icon: ImageIcon },
  { href: "/app/image-to-video", label: "图生视频", icon: Clapperboard },
  { href: "/app/history", label: "我的作品", icon: History },
  { href: "/app/account", label: "账号设置", icon: Settings },
];

const adminItems = [
  { href: "/admin/registrations", label: "注册审核", icon: ShieldCheck },
  { href: "/admin/users", label: "用户管理", icon: Users2 },
  { href: "/admin/models", label: "模型配置", icon: Plug },
  { href: "/admin/media-processing", label: "媒体处理", icon: Film },
  { href: "/admin/analytics", label: "数据看板", icon: BarChart3 },
];

export function AppSidebar({ kind = "user" }: { kind?: "user" | "admin" }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const items = kind === "admin" ? adminItems : userItems;

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border/60 bg-surface-1 md:flex md:flex-col">
      <div className="flex flex-col gap-1 p-3">
        <div className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {kind === "admin" ? "管理后台" : "工作台"}
        </div>
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight className="size-3.5 opacity-60" />}
            </Link>
          );
        })}
      </div>

      {kind === "user" && user?.role === "admin" && (
        <div className="mt-auto p-3">
          <Link
            href="/admin/registrations"
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ShieldCheck className="size-4 text-brand-400" />
            进入管理后台
            <ChevronRight className="ml-auto size-3.5 opacity-60" />
          </Link>
        </div>
      )}
      {kind === "admin" && (
        <div className="mt-auto p-3">
          <Link
            href="/app/text-to-image"
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ImageIcon className="size-4 text-aurora-400" />
            返回创作工作台
            <ChevronRight className="ml-auto size-3.5 opacity-60" />
          </Link>
        </div>
      )}
    </aside>
  );
}
