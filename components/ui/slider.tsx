"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
  formatValue?: (v: number) => string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  formatValue,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex-1 h-6 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-muted" />
        <div
          className="absolute h-1 rounded-full bg-gradient-to-r from-brand-400 to-brand-500"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute size-4 rounded-full bg-background border-2 border-brand-500 shadow-md pointer-events-none"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground tabular-nums w-10 text-right">
        {formatValue ? formatValue(value) : value}
      </span>
    </div>
  );
}
