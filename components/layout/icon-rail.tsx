"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ImageIcon, Clapperboard, Film, FolderOpen, Frame, Sparkles, Users2, ShieldCheck, LogOut, Settings2, Wrench, Mic2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/lib/store/auth-store";
import { getLastTabRoute, setLastTabRoute } from "@/lib/last-tab-route";

interface RailItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  /** Remember the last full URL within this tab so users return to where they left off. */
  remember?: boolean;
}

const ITEMS: RailItem[] = [
  { key: "create",      label: "创作",  icon: Sparkles,    href: "/app/text-to-image",  remember: true },
  { key: "video",       label: "视频",  icon: Clapperboard, href: "/app/image-to-video", remember: true },
  { key: "audio",       label: "音频",  icon: Mic2,         href: "/app/audio",          remember: true },
  { key: "canvas",      label: "画布",  icon: Frame,        href: "/app/canvas",         remember: true },
  { key: "tools",       label: "工具",  icon: Wrench,       href: "/app/tools",          remember: true },
  { key: "library",     label: "作品",  icon: FolderOpen,   href: "/app/history" },
  { key: "storyboards", label: "分镜",  icon: Film,         href: "/app/storyboards" },
  { key: "subjects",    label: "主体",  icon: Users2,       href: "/app/subjects" },
];

export function IconRail() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  // 记录用户当前所在 tab 的完整 URL（含 ?s=）。下次再点这个 tab 时就跳回这里。
  React.useEffect(() => {
    const qs = search?.toString();
    const fullUrl = qs ? `${pathname}?${qs}` : pathname;
    for (const item of ITEMS) {
      if (item.remember && (pathname === item.href || pathname.startsWith(item.href + "/"))) {
        setLastTabRoute(item.key, fullUrl);
      }
    }
  }, [pathname, search]);

  // Tab 链接的最终 href —— 路由变化时刷新（直接读 localStorage 派生，无需 state）
  const rememberedHrefs = React.useMemo(() => {
    const next: Record<string, string> = {};
    for (const item of ITEMS) {
      if (item.remember) {
        const last = getLastTabRoute(item.key);
        if (last) next[item.key] = last;
      }
    }
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return (
    <aside className="flex w-[68px] shrink-0 flex-col items-center justify-between border-r border-border/60 bg-surface-1 py-4">
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/app/text-to-image"
          className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300/30 to-aurora-400/30"
          aria-label="Lumen 主页"
        >
          <Logo showWord={false} size={22} />
        </Link>
        <div className="my-2 h-px w-7 bg-border" />
        <nav className="flex flex-col gap-1">
          {ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            // 在当前 tab 内点自己 → 用基础 href（即"返回 tab 主页"）；
            // 否则跳到上次记住的 URL（含会话 ?s=）。
            const targetHref = active ? item.href : (rememberedHrefs[item.key] ?? item.href);
            return (
              <Link
                key={item.key}
                href={targetHref}
                className={cn(
                  "group relative flex size-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="size-5" />
                <span className="leading-none tracking-tight">{item.label}</span>
                {active && (
                  <span className="absolute -left-1 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-brand-500" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-2">
        {user?.role === "admin" && (
          <Link
            href="/admin/registrations"
            className="flex size-10 flex-col items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="管理后台"
          >
            <ShieldCheck className="size-5" />
          </Link>
        )}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-full" aria-label="个人中心">
              <Avatar className="size-9 border border-border">
                <AvatarFallback className="text-[12px]">
                  {user?.role === "admin" ? "管" : "我"}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="min-w-[200px]">
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
              <span>个人中心</span>
              <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                当前身份 · {user?.role === "admin" ? "管理员" : "普通用户"}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/app/account"><Settings2 className="mr-2 size-4" />账号设置</Link>
            </DropdownMenuItem>
            {user?.role === "admin" && (
              <DropdownMenuItem asChild>
                <Link href="/admin/registrations"><ShieldCheck className="mr-2 size-4" />进入后台</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={async () => { await logout(); router.push("/"); }}>
              <LogOut className="mr-2 size-4" />退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

// suppress unused — kept for future "灵感" entry
void ImageIcon;
