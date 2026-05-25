"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Copy, Download, ExternalLink, Loader2, Play, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils";
import * as mpsApi from "@/lib/api/media-processing";
import {
  findTool,
  buildProcessMediaPayload,
  inputInfoFromUrl,
  type ToolField,
} from "@/lib/director/media-tools";
import type { MediaProcessingTask } from "@/lib/types";

interface ProcessMediaResponse {
  TaskId?: string;
  RequestId?: string;
}

export default function ToolDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const tool = findTool(params.id);

  // 配置：只读，从 admin 拿
  const [cosBucket, setCosBucket] = React.useState("");
  const [cosRegion, setCosRegion] = React.useState("");
  const [configured, setConfigured] = React.useState(false);

  // 输入：URL（可手填，也可上传后自动填）
  const [inputUrl, setInputUrl] = React.useState("");
  const [uploading, setUploading] = React.useState<{ pct: number } | null>(null);

  // 工具特定字段值
  const [fieldValues, setFieldValues] = React.useState<Record<string, string | number | boolean | undefined>>({});

  // 提交状态
  const [running, setRunning] = React.useState(false);
  const [latestTask, setLatestTask] = React.useState<MediaProcessingTask | null>(null);
  // 上游每次返回的原始 status（WAITING / PROCESSING / FINISH），用于 UI 显示
  const [upstreamStatus, setUpstreamStatus] = React.useState<string>("");
  const [pollCount, setPollCount] = React.useState(0);
  const [lastPollAt, setLastPollAt] = React.useState<number>(0);

  // 任务详情轮询：每 5s 查一次 DescribeTaskDetail，FINISH 时停止
  React.useEffect(() => {
    if (!latestTask?.upstreamTaskId) return;
    if (latestTask.status === "succeeded" || latestTask.status === "failed") return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || !latestTask.upstreamTaskId) return;
      try {
        const detail = await mpsApi.describeTaskDetail(latestTask.upstreamTaskId);
        if (cancelled) return;

        // 在浏览器 console 完整打出来，方便诊断
        console.log("[MPS] DescribeTaskDetail 返回：", detail);

        const tencentStatus = detail.Status ?? "";
        setUpstreamStatus(tencentStatus);
        setPollCount((n) => n + 1);
        setLastPollAt(Date.now());

        const errCode = detail.ProcessMediaTask?.ErrCode ?? 0;
        const errMessage = detail.ProcessMediaTask?.Message;

        if (tencentStatus === "FINISH") {
          const urls = mpsApi.extractOutputUrls(detail);
          const failed = errCode !== 0;
          if (failed) console.warn("[MPS] 任务失败：", { errCode, errMessage, detail });
          else console.log("[MPS] 任务完成 · 输出：", urls);
          const updated = mpsApi.updateTaskSync(latestTask.id, {
            status: failed ? "failed" : "succeeded",
            outputUrls: urls,
            errorMessage: failed ? (errMessage ?? `ErrCode ${errCode}`) : undefined,
            completedAt: new Date().toISOString(),
            progress: 100,
          });
          if (!cancelled) setLatestTask(updated);
        } else if (tencentStatus === "PROCESSING") {
          const updated = mpsApi.updateTaskSync(latestTask.id, {
            status: "running",
            progress: 60,
          });
          if (!cancelled) setLatestTask(updated);
        }
      } catch (e) {
        // 轮询临时错误别立刻把任务标失败
        console.error("[MPS] describeTaskDetail 失败：", e);
      }
    };
    tick(); // 立即查一次
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [latestTask?.id, latestTask?.upstreamTaskId, latestTask?.status]);

  // 初始化：拉 admin 配置 + 从 storage 恢复"未完成"的任务
  React.useEffect(() => {
    let cancelled = false;
    mpsApi.getConfig().then((cfg) => {
      if (cancelled) return;
      setConfigured(mpsApi.isConfigured(cfg));
      setCosBucket(cfg.cosBucket ?? "");
      setCosRegion(cfg.cosRegion ?? cfg.region);
    });
    // 页面挂载时找一下当前工具下最近的 running / 已完成任务，让用户不用重新提交也能看进度/结果
    if (user && tool) {
      Promise.resolve().then(() => {
        if (cancelled) return;
        const all = mpsApi.listTasksSync(user.id);
        const recent = all.find((t) => t.toolId === tool.id);
        if (recent) {
          setLatestTask(recent);
          if (recent.status === "running" || recent.status === "queued") {
            setInputUrl(recent.inputUrl);
          }
        }
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool?.id, user?.id]);

  // 工具切换时重置默认字段（用 React 19 prev-prop-during-render 模式）
  const [lastToolId, setLastToolId] = React.useState(tool?.id);
  if (tool?.id !== lastToolId) {
    setLastToolId(tool?.id);
    const init: Record<string, string | number | boolean | undefined> = {};
    if (tool?.fields) {
      for (const f of tool.fields) {
        if (f.default !== undefined) init[f.key] = f.default;
      }
    }
    setFieldValues(init);
  }

  if (!tool) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Button variant="ghost" size="sm" onClick={() => router.push("/app/tools")}>
          <ArrowLeft className="size-4" />返回工具
        </Button>
        <div className="mt-8 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          未知工具：{params.id}
        </div>
      </div>
    );
  }

  const onUpload = async (file: File) => {
    if (!cosBucket || !cosRegion) {
      toast.error("管理员还没配置 COS Bucket / Region，无法直传");
      return;
    }
    const cfg = mpsApi.getConfigSync();
    setUploading({ pct: 0 });
    try {
      // 1) 拿预签名 URL
      const signRes = await fetch("/api/cos-sign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lumen-API-Key": `${cfg.secretId.trim()}:${cfg.secretKey.trim()}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          bucket: cosBucket,
          region: cosRegion,
        }),
      });
      if (!signRes.ok) {
        const err = await signRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "签名失败");
      }
      const { uploadUrl, finalUrl } = (await signRes.json()) as { uploadUrl: string; finalUrl: string };

      // 2) 直接 PUT 到 COS
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploading({ pct: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`COS PUT 失败 (HTTP ${xhr.status})：${xhr.responseText.slice(0, 200)}`));
        };
        // onerror 通常是 CORS 拦截 —— 给清晰的指引而不是模糊的"网络错误"
        xhr.onerror = () => reject(new Error(
          "COS 跨域被拦截 —— 请到 COS 控制台 → 桶 → 安全管理 → 跨域访问 CORS 设置 添加规则：" +
          "来源 *（或 localhost:3000），方法 PUT/GET/POST/HEAD，Allow-Headers *。" +
          "保存后立即生效，无需重启。",
        ));
        xhr.ontimeout = () => reject(new Error("COS PUT 超时"));
        xhr.send(file);
      });

      setInputUrl(finalUrl);
      toast.success("上传成功，已自动填入输入 URL");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(null);
    }
  };

  const onSubmit = async () => {
    if (!user) return;
    if (!tool.implemented) {
      toast.error(`「${tool.name}」适配器尚未实现，请用「创建自定义任务」手填 ProcessMedia 字段。`);
      return;
    }
    if (!inputUrl.trim()) {
      toast.error("请上传文件或填入输入 URL");
      return;
    }

    setRunning(true);
    try {
      const inputInfo = inputInfoFromUrl(inputUrl.trim());
      const outputStorage = cosBucket && cosRegion
        ? { Type: "COS", CosOutputStorage: { Bucket: cosBucket, Region: cosRegion } }
        : undefined;

      const payload = buildProcessMediaPayload({
        toolId: tool.id,
        inputInfo,
        outputStorage,
        outputDir: "/lumen-out/",
        fieldValues,
      });

      const local = mpsApi.createTaskSync({
        userId: user.id,
        toolId: tool.id,
        inputUrl: inputUrl.trim(),
        params: payload as Record<string, unknown>,
      });

      const resp = await mpsApi.callMps<ProcessMediaResponse>({
        action: tool.action,
        payload,
      });

      const updated = mpsApi.updateTaskSync(local.id, {
        status: "running",
        upstreamTaskId: resp.TaskId,
      });
      setLatestTask(updated);
      toast.success(`已提交 · TaskId: ${resp.TaskId ?? "(无返回)"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setRunning(false);
    }
  };

  const canUpload = configured && !!cosBucket && !!cosRegion;

  return (
    <div className="w-full px-6 py-6 xl:px-10 2xl:px-14">
      <Button variant="ghost" size="sm" onClick={() => router.push("/app/tools")}>
        <ArrowLeft className="size-4" />返回工具
      </Button>

      <div className="mt-4 mb-6 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-3xl">{tool.icon}</span>
            <h1 className="font-display text-3xl tracking-tight">{tool.name}</h1>
            {tool.badge && (
              <Badge variant={tool.badge.tone} className="ml-1">
                {tool.badge.label}
              </Badge>
            )}
            {!tool.implemented && (
              <Badge variant="muted">待接入</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tool.hint}</p>
        </div>
        <a
          href="https://cloud.tencent.com/document/product/862"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-brand-500 hover:underline"
        >
          MPS 文档 <ExternalLink className="size-3" />
        </a>
      </div>

      {!configured && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-xs text-amber-700 dark:text-amber-400">
          ⚠️ 媒体处理服务未启用 —— 请联系管理员到「管理后台 → 媒体处理」配置腾讯云密钥 + COS 存储桶。
        </div>
      )}

      {configured && cosBucket && (
        <div
          className="mb-4 flex h-2 w-2 items-center"
          title={`已配置 · ${cosBucket} · ${cosRegion}`}
        >
          <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        {/* 上传 + URL */}
        <div className="space-y-2">
          <Label>输入文件 *</Label>
          <UploadDropZone
            disabled={!canUpload || uploading !== null}
            uploading={uploading}
            onPick={onUpload}
            hint={canUpload ? undefined : "需要管理员配置 COS Bucket / Region 才能直传"}
          />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>或</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="粘贴 COS 路径或公网 URL（如 https://your.cos.ap-shanghai.myqcloud.com/in.mp4）"
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>

        {/* 工具特定字段 */}
        {tool.fields && tool.fields.length > 0 && (
          <div className="space-y-3 rounded-lg border border-dashed border-border bg-surface-1 p-4">
            <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {tool.name}参数
            </div>
            {tool.fields.map((f) => (
              <ToolFieldInput
                key={f.key}
                field={f}
                value={fieldValues[f.key]}
                onChange={(v) => setFieldValues((s) => ({ ...s, [f.key]: v }))}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <Button variant="brand" onClick={onSubmit} disabled={running || !configured}>
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            发起任务
          </Button>
          {latestTask?.upstreamTaskId && (
            <span className="truncate text-[11px] text-muted-foreground">
              上游 TaskId: <span className="font-mono">{latestTask.upstreamTaskId}</span>
            </span>
          )}
        </div>
      </div>

      {/* 右列：任务结果 */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        {latestTask ? (
          <TaskResultPanel
            task={latestTask}
            upstreamStatus={upstreamStatus}
            pollCount={pollCount}
            lastPollAt={lastPollAt}
          />
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-1/40 p-10 text-center">
            <div className="text-4xl opacity-40">{tool.icon}</div>
            <div className="text-sm text-muted-foreground">
              上传文件并发起任务后，结果将显示在这里
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function TaskResultPanel({
  task, upstreamStatus, pollCount, lastPollAt,
}: {
  task: MediaProcessingTask;
  upstreamStatus?: string;
  pollCount?: number;
  lastPollAt?: number;
}) {
  const isRunning = task.status === "running" || task.status === "queued";
  const isSucceeded = task.status === "succeeded";
  const isFailed = task.status === "failed";
  const urls = task.outputUrls ?? [];

  // 跳秒钟表：running 时每秒重渲染拿到新的 now
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);
  const elapsedSec = Math.max(0, Math.floor((now - +new Date(task.createdAt)) / 1000));
  const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-3 flex items-center gap-2">
        {isRunning && <Loader2 className="size-4 animate-spin text-brand-400" />}
        {isSucceeded && <CheckCircle2 className="size-4 text-emerald-400" />}
        {isFailed && <XCircle className="size-4 text-destructive" />}
        <h2 className="text-sm font-medium">
          {isRunning && "任务进行中"}
          {isSucceeded && "任务完成"}
          {isFailed && "任务失败"}
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {isRunning ? "每 5 秒自动刷新" : `输出 ${urls.length} 个文件`}
        </span>
      </div>

      {isRunning && (
        <div className="space-y-2">
          {/* 状态行：上游 status + 已耗时 + 轮询次数 */}
          <div className="flex items-center gap-3 rounded-lg border border-zinc-700/40 bg-zinc-900/40 px-3 py-2 text-[11px]">
            <span className="text-zinc-500">上游状态</span>
            <span className={cn(
              "rounded px-2 py-0.5 font-mono text-[10px] font-medium",
              upstreamStatus === "PROCESSING" ? "bg-amber-400/15 text-amber-200" :
              upstreamStatus === "WAITING"    ? "bg-sky-400/15 text-sky-200" :
              upstreamStatus === "FINISH"     ? "bg-emerald-400/15 text-emerald-200" :
                                                "bg-zinc-800 text-zinc-400"
            )}>
              {upstreamStatus || "QUERYING"}
            </span>
            <span className="text-zinc-500">已耗时</span>
            <span className="font-mono tabular-nums text-zinc-300">{elapsedStr}</span>
            <span className="text-zinc-500">轮询</span>
            <span className="font-mono tabular-nums text-zinc-300">{pollCount ?? 0} 次</span>
            {lastPollAt && lastPollAt > 0 && (
              <span className="ml-auto text-zinc-600">
                上次 {Math.max(1, Math.floor((now - lastPollAt) / 1000))}s 前
              </span>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground">
            提交于 {new Date(task.createdAt).toLocaleTimeString()} ·
            <span className="ml-1">音视频增强（大模型 1080P）通常需要 3-15 分钟，4K 更久</span>
            <span className="mx-1">·</span>
            <a
              href="https://console.cloud.tencent.com/mps/tasks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 hover:underline"
            >
              MPS 控制台直查 ↗
            </a>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full animate-pulse bg-brand-500 transition-all"
              style={{ width: `${upstreamStatus === "WAITING" ? 15 : upstreamStatus === "PROCESSING" ? 60 : 30}%` }}
            />
          </div>
        </div>
      )}

      {isFailed && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {task.errorMessage ?? "未知错误"}
        </div>
      )}

      {isSucceeded && urls.length === 0 && (
        <div className="space-y-3">
          <div className="text-[11px] text-muted-foreground">
            任务完成但本地没缓存到输出 URL —— 可能上次解析失败 / 字段错过。
            可点下方按钮再查一次或直接到控制台对照。
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!task.upstreamTaskId) return;
                try {
                  toast.message("正在重新查询…");
                  const detail = await mpsApi.describeTaskDetail(task.upstreamTaskId);
                  console.log("[MPS] 手动重查响应：", detail);
                  const fresh = mpsApi.extractOutputUrls(detail);
                  if (fresh.length > 0) {
                    mpsApi.updateTaskSync(task.id, { outputUrls: fresh });
                    toast.success(`找到 ${fresh.length} 个输出文件，刷新一下`);
                    location.reload();
                  } else {
                    toast.warning("还是没找到 —— 看浏览器 console 里完整响应，发给我");
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "查询失败");
                }
              }}
            >
              重新查询输出
            </Button>
            <a
              href="https://console.cloud.tencent.com/mps/tasks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-500 hover:underline self-center"
            >
              MPS 控制台 ↗
            </a>
            <a
              href={`https://console.cloud.tencent.com/cos/bucket?action=list&bucket=`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-500 hover:underline self-center"
            >
              COS 桶查文件 ↗
            </a>
          </div>
        </div>
      )}

      {isSucceeded && urls.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {urls.map((u, i) => (
            <OutputCard key={u + i} url={u} />
          ))}
        </div>
      )}
    </div>
  );
}

function OutputCard({ url }: { url: string }) {
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);
  const [signing, setSigning] = React.useState(true);
  const [signError, setSignError] = React.useState<string | null>(null);

  // url 变更时重置签名状态（React 19 prev-prop-during-render 模式）
  const [lastUrl, setLastUrl] = React.useState(url);
  if (url !== lastUrl) {
    setLastUrl(url);
    setSigning(true);
    setSignError(null);
    setSignedUrl(null);
  }

  // 签 URL 拿到能预览的链接
  React.useEffect(() => {
    let cancelled = false;
    mpsApi
      .signGetUrl(url, 3600)
      .then((u) => { if (!cancelled) { setSignedUrl(u); setSigning(false); } })
      .catch((e) => {
        if (cancelled) return;
        setSignError(e instanceof Error ? e.message : "签名失败");
        setSigning(false);
      });
    return () => { cancelled = true; };
  }, [url]);

  const fileName = (() => {
    try {
      const p = new URL(url).pathname;
      return decodeURIComponent(p.split("/").pop() ?? p);
    } catch {
      return url.split("/").pop() ?? url;
    }
  })();
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const kind: "video" | "image" | "audio" | "subtitle" | "other" =
    ["mp4", "mov", "webm", "mkv", "avi", "flv"].includes(ext) ? "video"
    : ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext) ? "image"
    : ["mp3", "wav", "aac", "m4a", "flac", "ogg"].includes(ext) ? "audio"
    : ["srt", "vtt", "ass", "ssa"].includes(ext) ? "subtitle"
    : "other";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已复制 COS 路径");
    } catch {
      toast.error("复制失败");
    }
  };
  const download = async () => {
    if (!signedUrl) return;
    try {
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 给浏览器一会儿再回收，避免还没真正触发下载就 revoke
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) {
      toast.error(`下载失败：${e instanceof Error ? e.message : ""}`);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-700/40 bg-zinc-900/40">
      {/* 媒体预览 */}
      <div className="bg-black">
        {signing && (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />正在签发临时访问 URL…
          </div>
        )}
        {signError && (
          <div className="flex h-48 items-center justify-center px-4 text-center text-xs text-destructive">
            ⚠️ 临时访问 URL 签发失败：{signError}
          </div>
        )}
        {signedUrl && kind === "video" && (
          <video
            src={signedUrl}
            controls
            preload="metadata"
            className="aspect-video w-full bg-black"
          />
        )}
        {signedUrl && kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signedUrl} alt={fileName} className="max-h-[480px] w-full object-contain" />
        )}
        {signedUrl && kind === "audio" && (
          <div className="flex items-center justify-center bg-zinc-950 p-6">
            <audio src={signedUrl} controls className="w-full max-w-md" />
          </div>
        )}
        {signedUrl && kind === "subtitle" && (
          <SubtitlePreview signedUrl={signedUrl} />
        )}
        {signedUrl && kind === "other" && (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            （此格式不支持内联预览，点右下角下载到本地查看）
          </div>
        )}
      </div>

      {/* 文件名 + 操作按钮 */}
      <div className="flex items-center gap-2 border-t border-zinc-700/40 bg-zinc-900/60 px-3 py-2">
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-300">
          {ext || "FILE"}
        </span>
        <code className="flex-1 truncate font-mono text-[11px] text-zinc-300" title={fileName}>
          {fileName}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          title="复制 COS 路径"
        >
          <Copy className="size-3.5" />
        </button>
        {signedUrl && (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            title="在新标签打开（带签名 1 小时有效）"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={download}
          disabled={!signedUrl}
          className="ml-1 inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-medium text-zinc-950 hover:bg-amber-400 disabled:bg-amber-500/40"
        >
          <Download className="size-3.5" />下载到本地
        </button>
      </div>
    </div>
  );
}

function SubtitlePreview({ signedUrl }: { signedUrl: string }) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch(signedUrl)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setText("(预览加载失败)"); });
    return () => { cancelled = true; };
  }, [signedUrl]);
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-300">
      {text ?? "加载字幕…"}
    </pre>
  );
}

/* ─────────────────── 子组件 ─────────────────── */

function UploadDropZone({
  disabled, uploading, onPick, hint,
}: {
  disabled: boolean;
  uploading: { pct: number } | null;
  onPick: (f: File) => void;
  hint?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = React.useState(false);

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (disabled) return;
        const f = e.dataTransfer.files[0];
        if (f) onPick(f);
      }}
      className={[
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 transition-colors",
        disabled
          ? "cursor-not-allowed border-zinc-800 bg-zinc-900/40 text-zinc-600"
          : drag
            ? "border-brand-400 bg-brand-400/10 text-brand-500"
            : "border-zinc-700 bg-zinc-900/40 text-zinc-300 hover:border-brand-400/60 hover:bg-brand-400/5",
      ].join(" ")}
    >
      {uploading ? (
        <>
          <Loader2 className="size-5 animate-spin text-brand-400" />
          <div className="text-xs">上传中 · {uploading.pct}%</div>
          <div className="h-1 w-48 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${uploading.pct}%` }} />
          </div>
        </>
      ) : (
        <>
          <Upload className="size-5" />
          <div className="text-sm font-medium">{disabled ? "上传不可用" : "点击或拖入文件上传到 COS"}</div>
          <div className="text-[11px]">{hint ?? "支持视频 / 音频 / 图像"}</div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

function ToolFieldInput({
  field, value, onChange,
}: {
  field: ToolField;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {field.label}
        {field.required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {field.type === "template" && field.templateKind ? (
        <TemplateSelect
          kind={field.templateKind}
          value={typeof value === "number" ? value : undefined}
          defaultId={typeof field.default === "number" ? field.default : undefined}
          required={field.required}
          onChange={(v) => onChange(v)}
        />
      ) : field.type === "select" && field.options ? (
        <select
          value={typeof value === "number" ? String(value) : (value as string ?? "")}
          onChange={(e) => {
            const opt = field.options!.find((o) => String(o.value) === e.target.value);
            if (opt) onChange(opt.value);
          }}
          className="h-9 w-full rounded-md border border-input bg-background/40 px-3 text-sm"
        >
          {field.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.hint}
        </label>
      ) : field.type === "number" ? (
        <Input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder={field.default !== undefined ? String(field.default) : ""}
          className="font-mono text-xs"
        />
      ) : field.key === "extraJson" ? (
        <Textarea
          rows={6}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.hint}
          className="font-mono text-[11px]"
        />
      ) : (
        <Input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.hint}
          className="text-xs"
        />
      )}
      {field.hint && field.type !== "boolean" && (
        <p className="text-[10.5px] text-muted-foreground">{field.hint}</p>
      )}
    </div>
  );
}


/* ───────────────── 模板下拉选择（实时拉腾讯云模板列表）───────────────── */

// 已知 MPS 内置预设模板的中文名映射（按 Definition ID 命中）。命中就替换显示。
const PRESET_TEMPLATE_LABELS: Record<number, string> = {
  100010: "极速高清 · 1080P",
  100020: "极速高清 · 720P",
  100030: "极速高清 · 540P",
  100040: "极速高清 · 480P",
  10:     "时间点截图",
  20:     "采样截图",
  // 大模型增强 · 真人场景
  327001: "真人场景 · 720P",
  327003: "真人场景 · 1080P",
  327005: "真人场景 · 2K",
  327007: "真人场景 · 4K",
  // 大模型增强 · 动漫场景
  327002: "动漫场景 · 720P",
  327004: "动漫场景 · 1080P",
  327006: "动漫场景 · 2K",
  327008: "动漫场景 · 4K",
  // 大模型修复 · 老片
  327021: "老片修复 · 720P",
  327022: "老片修复 · 1080P",
  327023: "老片修复 · 2K",
  327024: "老片修复 · 4K",
};

// 解析腾讯云预设转码/增强模板的英文 Name，自动转中文。
// 例：DiffusionEnhance-Real-MP4-1080P-SourceFrameRate-TSC → 真人场景 · 1080P
function parsePresetName(name: string): string | null {
  if (!name) return null;
  if (/diffusionenhance/i.test(name) || /enhance/i.test(name)) {
    const scene = /-real-/i.test(name)  ? "真人场景"
                : /-anime-/i.test(name) ? "动漫场景"
                : null;
    const res = name.match(/-(\d{3,4}P|2K|4K|8K)-/i)?.[1]?.toUpperCase() ?? null;
    const parts = [scene, res].filter(Boolean) as string[];
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

function templateOptionLabel(t: import("@/lib/api/media-processing").MpsTemplate): string {
  const byId = PRESET_TEMPLATE_LABELS[t.Definition];
  if (byId) return `${t.Definition} · ${byId}`;
  const byName = parsePresetName(t.Name ?? "");
  if (byName) return `${t.Definition} · ${byName}`;
  const base = t.Name ?? "未命名";
  return `${t.Definition} · ${base}${t.Comment ? ` — ${t.Comment.slice(0, 30)}` : ""}`;
}

// 各 TemplateKind 对应的「去控制台创建」深链 + UI 文案
const TEMPLATE_KIND_META: Record<
  import("@/lib/api/media-processing").TemplateKind,
  { label: string; consoleUrl: string }
> = {
  "transcode":         { label: "转码模板",       consoleUrl: "https://console.cloud.tencent.com/mps/templateCommon" },
  "transcode-enhance": { label: "音视频增强模板", consoleUrl: "https://console.cloud.tencent.com/mps/templateEnhance" },
  "watermark":         { label: "水印模板",       consoleUrl: "https://console.cloud.tencent.com/mps/watermark" },
  "smart-erase":       { label: "智能擦除模板",   consoleUrl: "https://console.cloud.tencent.com/mps/smartErase" },
  "smart-subtitle":    { label: "智能字幕模板",   consoleUrl: "https://console.cloud.tencent.com/mps/smartSubtitle" },
  "ai-analysis":       { label: "AI 分析模板",    consoleUrl: "https://console.cloud.tencent.com/mps/templateAnalysis" },
  "ai-qc":             { label: "媒体质检模板",   consoleUrl: "https://console.cloud.tencent.com/mps/templateQC" },
  "snapshot":          { label: "截图模板",       consoleUrl: "https://console.cloud.tencent.com/mps/templateSnapshot" },
  "animated":          { label: "转动图模板",     consoleUrl: "https://console.cloud.tencent.com/mps/templateAnimatedGraphics" },
};

function TemplateSelect({
  kind, value, defaultId, required, onChange,
}: {
  kind: import("@/lib/api/media-processing").TemplateKind;
  value: number | undefined;
  defaultId?: number;
  required?: boolean;
  onChange: (id: number | undefined) => void;
}) {
  const [list, setList] = React.useState<import("@/lib/api/media-processing").MpsTemplate[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const fetchList = React.useCallback(() => {
    setList(null);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // kind 变更时重置（React 19 prev-prop-during-render 模式）
  const [lastKind, setLastKind] = React.useState(kind);
  if (kind !== lastKind) {
    setLastKind(kind);
    setList(null);
    setError(null);
  }

  React.useEffect(() => {
    let cancelled = false;
    mpsApi.listTemplates(kind)
      .then((arr) => {
        if (cancelled) return;
        setList(arr);
        if (value === undefined) {
          const fallback = (defaultId !== undefined && arr.find((t) => t.Definition === defaultId))
            ? defaultId
            : arr[0]?.Definition;
          if (fallback !== undefined) onChange(fallback);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "拉模板列表失败");
      });
    return () => { cancelled = true; };
  // 只在 kind 变化或手动 reload 时重拉
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, reloadKey]);

  const handleQuickCreateWatermark = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const def = await mpsApi.createDefaultWatermarkTemplate();
      // 立即重新拉列表并选中新模板
      const arr = await mpsApi.listTemplates(kind);
      setList(arr);
      onChange(def);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  if (list === null && !error) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-background/40 px-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />正在拉取模板列表…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-1.5">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          ⚠️ 拉模板失败：{error}
        </div>
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          placeholder="降级 · 手填模板 ID"
          className="font-mono text-xs"
        />
      </div>
    );
  }

  if (list && list.length === 0) {
    const meta = TEMPLATE_KIND_META[kind];
    return (
      <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/[0.04] p-3">
        <div className="flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-400">
          <span className="text-base leading-none">📭</span>
          <span>
            你账号下还没有任何<b>{meta.label}</b>。
            {kind === "watermark"
              ? " 点下面按钮一键创建 Lumen 默认文字水印（右上角白字、字号 32、半透明），创建后会自动选中。"
              : " 需要先到 MPS 控制台创建一份模板，回来刷新就能看到。"}
          </span>
        </div>

        {kind === "watermark" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleQuickCreateWatermark}
              disabled={creating}
              className="h-8 gap-1.5 text-xs"
            >
              {creating ? (
                <><Loader2 className="size-3.5 animate-spin" /> 创建中…</>
              ) : (
                <>＋ 一键创建默认水印模板</>
              )}
            </Button>
            <a
              href={meta.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground underline-offset-4 hover:underline"
            >
              或去控制台自定义 ↗
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={meta.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent"
            >
              去控制台创建 ↗
            </a>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => fetchList()}
              className="h-8 gap-1.5 text-xs"
            >
              ↻ 已创建，刷新列表
            </Button>
          </div>
        )}

        {createError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
            创建失败：{createError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <select
        value={value !== undefined ? String(value) : ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className="h-9 w-full rounded-md border border-input bg-background/40 px-3 text-sm"
      >
        {!required && <option value="">（不使用）</option>}
        {list!.map((t) => (
          <option key={t.Definition} value={String(t.Definition)}>
            {templateOptionLabel(t)}
          </option>
        ))}
      </select>
      <p className="text-[10.5px] text-muted-foreground">
        共 {list!.length} 个模板 ·
        <a
          href="https://console.cloud.tencent.com/mps/template"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-brand-500 hover:underline"
        >
          管理模板 ↗
        </a>
      </p>
    </div>
  );
}
