"use client";

import * as React from "react";
import { CheckCircle2, ExternalLink, Film, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import * as mpsApi from "@/lib/api/media-processing";
import type { MediaProcessingConfig } from "@/lib/types";

const REGION_OPTIONS = [
  { value: "ap-shanghai",  label: "ap-shanghai · 上海" },
  { value: "ap-guangzhou", label: "ap-guangzhou · 广州" },
  { value: "ap-beijing",   label: "ap-beijing · 北京" },
  { value: "ap-chengdu",   label: "ap-chengdu · 成都" },
  { value: "ap-hongkong",  label: "ap-hongkong · 香港" },
  { value: "ap-singapore", label: "ap-singapore · 新加坡" },
];

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export default function MediaProcessingAdminPage() {
  const [cfg, setCfg] = React.useState<MediaProcessingConfig | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [test, setTest] = React.useState<TestState>({ status: "idle" });

  React.useEffect(() => {
    mpsApi.getConfig().then(setCfg);
  }, []);

  const patch = (p: Partial<MediaProcessingConfig>) => {
    setCfg((c) => c ? { ...c, ...p } : c);
  };

  const onSave = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const next = await mpsApi.saveConfig(cfg);
      setCfg(next);
      toast.success("已保存腾讯云媒体处理配置");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (!cfg) return;
    if (!cfg.secretId.trim() || !cfg.secretKey.trim()) {
      setTest({ status: "error", message: "请先填入 SecretId 和 SecretKey" });
      return;
    }
    // 先把当前表单值保存进去，再调测试
    await mpsApi.saveConfig(cfg);
    setTest({ status: "running" });
    try {
      const r = await mpsApi.callMps<{ TaskSet?: unknown[] }>({
        action: "DescribeTasks",
        payload: { Status: "FINISH", Limit: 1 },
      });
      const taskCount = r.TaskSet?.length ?? 0;
      setTest({ status: "ok", message: `鉴权通过 · 已完成任务 ${taskCount}+ 个` });
    } catch (e) {
      setTest({ status: "error", message: e instanceof Error ? e.message : "测试失败" });
    }
  };

  if (!cfg) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />载入配置…
      </div>
    );
  }

  const configured = mpsApi.isConfigured(cfg);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Film className="size-5 text-brand-400" />
            <h1 className="font-display text-3xl tracking-tight">媒体处理</h1>
            {configured ? (
              <Badge variant="success" className="ml-2">已启用</Badge>
            ) : (
              <Badge variant="muted" className="ml-2">未启用</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            接入腾讯云媒体处理 (MPS) — 转码 / AIGC / 智能字幕 / 配音译制 / 媒体质检 等。
            配置好后用户在创作工作台「工具」里直接发起任务。
          </p>
        </div>
        <a
          href="https://console.cloud.tencent.com/cam/capi"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-500 hover:underline"
        >
          获取 API 密钥 <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
        {/* 启用开关 */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-1 p-4">
          <div>
            <div className="font-medium">为所有用户启用媒体处理工具</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              关闭后用户工作台「工具」入口隐藏，已发起的任务不受影响。
            </p>
          </div>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => patch({ enabled: v })}
          />
        </div>

        {/* SecretId / SecretKey */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="SecretId" required>
            <Input
              value={cfg.secretId}
              onChange={(e) => patch({ secretId: e.target.value })}
              placeholder="AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              spellCheck={false}
              autoComplete="off"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="SecretKey" required>
            <Input
              type="password"
              value={cfg.secretKey}
              onChange={(e) => patch({ secretKey: e.target.value })}
              placeholder="32 位字符 · 仅本人可见"
              spellCheck={false}
              autoComplete="new-password"
              className="font-mono text-xs"
            />
          </Field>
        </div>

        {/* Region */}
        <Field label="API 区域" required>
          <select
            value={cfg.region}
            onChange={(e) => patch({ region: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background/40 px-3 text-sm"
          >
            {REGION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            必须与你账号开通 MPS 服务的区域一致；通常选 ap-shanghai。
          </p>
        </Field>

        {/* COS（用户上传 + MPS 输出共用） */}
        <div className="space-y-3 rounded-xl border border-brand-400/30 bg-brand-400/5 p-4">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-brand-500">
            <span>用户存储桶</span>
            <span className="rounded-md bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-normal text-brand-500">
              所有工具共用
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            填好之后用户在「工具」里就能直接拖文件上传，MPS 任务结果也写到同一个桶 ——
            **用户端不再需要配置任何路径**，零参数直用。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="COS Bucket" required>
              <Input
                value={cfg.cosBucket ?? ""}
                onChange={(e) => patch({ cosBucket: e.target.value })}
                placeholder="例如 fycosaaa-1301133951（完整名带 APPID 后缀）"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="COS 区域" required>
              <Input
                value={cfg.cosRegion ?? ""}
                onChange={(e) => patch({ cosRegion: e.target.value })}
                placeholder="ap-shanghai · ap-chengdu …"
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
            ⚠️ <b>记得给桶配 CORS</b>：COS 控制台 → 桶 → 安全管理 → 跨域访问 CORS 设置。
            来源加 <code className="font-mono">http://localhost:3000</code> + 你的部署域名，
            方法 <code className="font-mono">PUT/GET/POST/HEAD</code>，不然浏览器直传会被跨域拦掉。
          </div>
        </div>

        {/* 测试连接 */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <Button onClick={onTest} disabled={test.status === "running"} variant="outline" size="sm">
            {test.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            测试连接
          </Button>
          <TestPill state={test} />
        </div>

        {/* Stage-1 风险提示 */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            ⚠️ Stage-1 演示阶段：SecretId / SecretKey 明文存在浏览器 localStorage，DevTools 仍可见。
            正式接入需要后端加密存储 + 用户级隔离（迁 DB 时一并做）。
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => mpsApi.getConfig().then(setCfg)}>
            重置
          </Button>
          <Button variant="brand" onClick={onSave} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            保存配置
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function TestPill({ state }: { state: TestState }) {
  if (state.status === "idle")    return <span className="text-[11px] text-muted-foreground">未测试</span>;
  if (state.status === "running") return <span className="text-[11px] text-muted-foreground">调用中…</span>;
  if (state.status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
        <CheckCircle2 className="size-3.5" />{state.message}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
      <XCircle className="size-3.5" />{state.message}
    </span>
  );
}
