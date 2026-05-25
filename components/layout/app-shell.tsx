"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { IconRail } from "./icon-rail";
import { ConversationSidebar } from "./conversation-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();

  // 这些页面没有 session 概念（画布有自己的密集 rail；工具/作品/主体是列表型工作流），
  // 隐藏会话侧栏，把宽度让出来。
  const hideConversationSidebar =
    pathname.startsWith("/app/canvas") ||
    pathname.startsWith("/app/tools") ||
    pathname.startsWith("/app/history") ||
    pathname.startsWith("/app/subjects");

  return (
    <div className="flex h-full">
      <IconRail />
      {!hideConversationSidebar && (
        <ConversationSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      )}
      <main className="flex-1 overflow-hidden bg-background">{children}</main>
    </div>
  );
}
