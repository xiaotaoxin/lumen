"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { IconRail } from "./icon-rail";
import { ConversationSidebar } from "./conversation-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();

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
