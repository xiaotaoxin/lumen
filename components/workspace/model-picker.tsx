"use client";

import { Check, ImageIcon, Clapperboard, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";
import type { ModelInfo } from "@/lib/types";

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {models.map((m) => {
        const active = m.id === value;
        return (
          <button
            type="button"
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "group flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all",
              active
                ? "border-brand-400/60 bg-brand-500/5"
                : "border-border bg-card hover:border-brand-400/30 hover:bg-secondary/50",
            )}
          >
            <div
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                active
                  ? "bg-gradient-to-br from-brand-400/30 to-aurora-400/30 text-brand-400"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {m.kind === "image" ? <ImageIcon className="size-4" /> : <Clapperboard className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{m.name}</span>
                {m.badge && (
                  <Badge
                    variant={m.badge === "premium" ? "warning" : "brand"}
                    className="text-[10px] py-0 px-1.5"
                  >
                    {m.badge}
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{m.description}</div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Zap className="size-3" />
                  ~{(m.avgLatencyMs / 1000).toFixed(1)}s
                </span>
                <span className="font-mono">{formatNumber(m.costPerCall)} cr</span>
              </div>
            </div>
            {active && <Check className="size-4 shrink-0 text-brand-400" />}
          </button>
        );
      })}
    </div>
  );
}
