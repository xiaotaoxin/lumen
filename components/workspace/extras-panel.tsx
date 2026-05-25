"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { ExtraField } from "./extra-field";
import type { ExtraParam } from "@/lib/types";

interface Props {
  /** The list of advanced params declared by the model's adapter. */
  spec: ExtraParam[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** e.g. "通义万相 Turbo 高级参数". */
  title?: string;
}

/**
 * Renders the model-specific "advanced params" section. Shows nothing if
 * the spec is empty (most adapters don't declare extras). Used inside the
 * existing 高级参数 popover so we don't introduce a new chrome surface.
 */
export function ExtrasPanel({ spec, value, onChange, title }: Props) {
  if (!spec || spec.length === 0) return null;

  const setKey = (key: string) => (next: unknown) => {
    const merged = { ...value };
    if (next === undefined || next === "") delete merged[key];
    else merged[key] = next;
    onChange(merged);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        <Sparkles className="size-3" />
        {title ?? "模型独有参数"}
      </div>
      <div className="space-y-3">
        {spec.map((ep) => (
          <ExtraField
            key={ep.key}
            spec={ep}
            value={value[ep.key]}
            onChange={setKey(ep.key)}
          />
        ))}
      </div>
    </div>
  );
}
