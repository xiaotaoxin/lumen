"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { ExtraParam } from "@/lib/types";

interface Props {
  spec: ExtraParam;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Renders a single ExtraParam declaration as the appropriate input control.
 * Shapes the value back into the right primitive type so adapters can
 * forward `params.extras[key]` straight into upstream payloads.
 */
export function ExtraField({ spec, value, onChange }: Props) {
  switch (spec.type) {
    case "select": {
      const v = (value as string | undefined) ?? (spec.default as string | undefined) ?? "";
      return (
        <FieldFrame label={spec.label} hint={spec.hint}>
          <Select value={v} onValueChange={(next) => onChange(next)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(spec.options ?? []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldFrame>
      );
    }
    case "number": {
      const v = (value as number | undefined) ?? (spec.default as number | undefined) ?? "";
      return (
        <FieldFrame label={spec.label} hint={spec.hint}>
          <Input
            type="number"
            value={v}
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") onChange(undefined);
              else onChange(Number(raw));
            }}
          />
        </FieldFrame>
      );
    }
    case "boolean": {
      const v = (value as boolean | undefined) ?? (spec.default as boolean | undefined) ?? false;
      return (
        <div className="flex items-start justify-between gap-3 py-1">
          <div className="min-w-0 flex-1">
            <Label className="text-sm">{spec.label}</Label>
            {spec.hint && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{spec.hint}</p>
            )}
          </div>
          <Switch checked={v} onCheckedChange={(checked) => onChange(checked)} />
        </div>
      );
    }
    case "text":
    default: {
      const v = (value as string | undefined) ?? (spec.default as string | undefined) ?? "";
      return (
        <FieldFrame label={spec.label} hint={spec.hint}>
          <Input
            type="text"
            value={v}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </FieldFrame>
      );
    }
  }
}

function FieldFrame({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
