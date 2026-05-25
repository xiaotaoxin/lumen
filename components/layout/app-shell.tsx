"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { IconRail } from "./icon-rail";
import { ConversationSidebar } from "./conversation-sidebar";
import { pageTransition } from "@/lib/animations";

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
      <main className="flex-1 overflow-hidden bg-background">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            variants={pageTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="h-full"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
