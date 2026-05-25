"use client";

import * as React from "react";
import {
  Activity, AlertTriangle, BarChart3, Clock, Coins, Users2, Zap,
} from "lucide-react";
import {
  Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis, CartesianGrid, Area, AreaChart,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import * as adminApi from "@/lib/api/admin";
import { formatRelativeTime, formatNumber } from "@/lib/utils";
import type { AdminMetrics } from "@/lib/types";

const PIE_COLORS = [
  "oklch(0.74 0.18 65)",   // brand-500
  "oklch(0.70 0.16 195)",  // aurora-500
  "oklch(0.86 0.14 75)",   // brand-300
  "oklch(0.78 0.15 195)",  // aurora-400
  "oklch(0.66 0.18 55)",   // brand-600
  "oklch(0.85 0.13 195)",  // aurora-300
  "oklch(0.55 0.16 50)",   // brand-700
  "oklch(0.43 0.13 50)",   // brand-800
  "oklch(0.32 0.10 50)",   // brand-900
];

export default function AnalyticsPage() {
  const [metrics, setMetrics] = React.useState<AdminMetrics | null>(null);
  const [period, setPeriod] = React.useState<"daily" | "weekly" | "monthly">("daily");

  React.useEffect(() => {
    adminApi.metrics().then(setMetrics);
  }, []);

  if (!metrics) return <Loading />;

  return (
    <div className="mx-auto max-w-screen-2xl p-8">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">数据看板</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            模型调用、消耗、失败率、平均耗时——一处看清。
          </p>
        </div>
      </div>

      {/* Top metric cards */}
      <div className="mb-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<Activity className="size-4" />}
          label="今日调用"
          value={formatNumber(metrics.totals.callsToday)}
          hint={`本周 ${formatNumber(metrics.totals.callsThisWeek)} · 本月 ${formatNumber(metrics.totals.callsThisMonth)}`}
        />
        <MetricCard
          icon={<Coins className="size-4" />}
          label="累计消耗"
          value={`${formatNumber(metrics.totals.creditsConsumedTotal)} cr`}
          hint="所有用户 · 全部模型"
        />
        <MetricCard
          icon={<AlertTriangle className="size-4" />}
          label="失败率"
          value={`${(metrics.totals.failureRate * 100).toFixed(1)}%`}
          hint={metrics.totals.failureRate < 0.05 ? "运行平稳" : "略偏高，关注"}
          accent={metrics.totals.failureRate < 0.05 ? "good" : "warn"}
        />
        <MetricCard
          icon={<Clock className="size-4" />}
          label="平均耗时"
          value={`${(metrics.totals.avgLatencyMs / 1000).toFixed(1)}s`}
          hint={`p95: ${(metrics.latency.p95Ms / 1000).toFixed(1)}s`}
        />
      </div>

      {/* Trend + model share */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="size-4 text-brand-500" />
                时间趋势
              </CardTitle>
              <CardDescription>调用量与消耗按时间聚合</CardDescription>
            </div>
            <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
              <TabsList className="h-8">
                <TabsTrigger value="daily" className="text-xs">日</TabsTrigger>
                <TabsTrigger value="weekly" className="text-xs">周</TabsTrigger>
                <TabsTrigger value="monthly" className="text-xs">月</TabsTrigger>
              </TabsList>
              <TabsContent value="daily" className="hidden" />
              <TabsContent value="weekly" className="hidden" />
              <TabsContent value="monthly" className="hidden" />
            </Tabs>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics.trend[period]} margin={{ left: -10, right: 6, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.74 0.18 65)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="oklch(0.74 0.18 65)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="areaCredits" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.70 0.16 195)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="oklch(0.70 0.16 195)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label" stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  />
                  <RTooltip content={<ChartTooltip />} />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                  <Area
                    type="monotone" dataKey="calls" name="调用次数"
                    stroke="oklch(0.74 0.18 65)" strokeWidth={2}
                    fill="url(#areaCalls)"
                  />
                  <Area
                    type="monotone" dataKey="credits" name="消耗 (cr)"
                    stroke="oklch(0.70 0.16 195)" strokeWidth={2}
                    fill="url(#areaCredits)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-aurora-400" />
              模型调用占比
            </CardTitle>
            <CardDescription>按调用次数排序</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.modelShare}
                    dataKey="calls"
                    nameKey="modelName"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="var(--background)"
                    strokeWidth={2}
                  >
                    {metrics.modelShare.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1">
              {metrics.modelShare.slice(0, 6).map((m, i) => (
                <div key={m.modelId} className="flex items-center gap-2 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: PIE_COLORS[i] }} />
                  <span className="flex-1 truncate text-muted-foreground">{m.modelName}</span>
                  <span className="font-mono tabular-nums">{(m.share * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Failure rate + latency */}
      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-destructive" />
              失败率（近 14 天）
            </CardTitle>
            <CardDescription>
              当前 {(metrics.failures.rate * 100).toFixed(1)}%
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.failures.series} margin={{ left: -10, right: 6, top: 6, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RTooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone" dataKey="calls" name="失败次数"
                    stroke="oklch(0.62 0.22 27)" strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-brand-400" />
              平均耗时（近 14 天）
            </CardTitle>
            <CardDescription>
              均值 {(metrics.latency.avgMs / 1000).toFixed(1)}s · p95 {(metrics.latency.p95Ms / 1000).toFixed(1)}s
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.latency.series} margin={{ left: -10, right: 6, top: 6, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}s`}
                  />
                  <RTooltip content={<ChartTooltip valueFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`} />} />
                  <Line
                    type="monotone" dataKey="avgLatencyMs" name="平均耗时"
                    stroke="oklch(0.74 0.18 65)" strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-user breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users2 className="size-4 text-brand-500" />
            用户消耗排行
          </CardTitle>
          <CardDescription>按调用次数倒序，前 50 名</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b border-border bg-surface-2 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground">
              <div>用户</div>
              <div className="text-right">调用次数</div>
              <div className="text-right">消耗 (cr)</div>
              <div className="text-right">最近活跃</div>
            </div>
            {metrics.perUser.length === 0 ? (
              <div className="p-12 text-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              metrics.perUser.slice(0, 50).map((u) => (
                <div
                  key={u.userId}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 border-b border-border/60 px-4 py-2.5 text-sm last:border-0 hover:bg-secondary/30"
                >
                  <div className="font-medium">{u.username}</div>
                  <div className="text-right font-mono tabular-nums">{u.calls}</div>
                  <div className="text-right font-mono tabular-nums">{u.credits}</div>
                  <div className="text-right text-xs text-muted-foreground">{formatRelativeTime(u.lastActiveAt)}</div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon, label, value, hint, accent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: "default" | "good" | "warn";
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
          <span
            className={
              accent === "good"
                ? "text-emerald-500"
                : accent === "warn"
                  ? "text-amber-500"
                  : "text-brand-500"
            }
          >
            {icon}
          </span>
        </div>
        <div className="mt-3 font-display text-3xl tracking-tight tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({
  active, payload, label, valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value: number; color?: string }>;
  label?: string;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono tabular-nums">
            {valueFormatter ? valueFormatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-screen-2xl p-8">
      <div className="mb-8 h-10 w-48 animate-pulse rounded-md bg-secondary" />
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-secondary" />
        ))}
      </div>
      <div className="mt-6 h-80 animate-pulse rounded-2xl bg-secondary" />
    </div>
  );
}
