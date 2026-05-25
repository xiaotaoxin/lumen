"use client";

/**
 * 人声分离面板 — Demucs (HuggingFace Space 浏览器直连)
 *
 * 用户上传歌 → 浏览器把文件 base64 → 调 abidlabs/music-separation Space → 出 4 轨
 * （vocals / drums / bass / other）→ blob URL 播放 / 下载。
 *
 * 走 lib/hf-direct（已有基建），不通过 Node fetch（国内 ISP 易拦截 hf.space）。
 */

import * as React from "react";
import { Loader2, Upload, Download, FileAudio, Music, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { callHfSpaceWithRetry, checkHfReachable, HfTransientError } from "@/lib/hf-direct";

/**
 * Demucs HF Space 备选清单 —— 免费公共 Space 经常排队拥堵 / 临时下线，
 * 用户可在 UI 上切换。提交时按当前选中的 Space 调用。
 */
const SPACES = [
  { id: "abidlabs/music-separation", label: "abidlabs/music-separation · 4 轨", stems: 4 as const },
  { id: "tumuyan/demucs",           label: "tumuyan/demucs · 2 轨（人声+伴奏）",  stems: 2 as const },
  { id: "aimuzik/demucs",           label: "aimuzik/demucs · 4 轨",              stems: 4 as const },
];

interface Stem {
  name: "vocals" | "drums" | "bass" | "other";
  label: string;
  url: string;
  blob: Blob;
}

const STEM_LABELS: Record<Stem["name"], string> = {
  vocals: "人声",
  drums:  "鼓",
  bass:   "贝斯",
  other:  "其它伴奏",
};

export function SeparatePanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [spaceId, setSpaceId] = React.useState<string>(SPACES[0].id);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<string>("");
  const [stems, setStems] = React.useState<Stem[]>([]);
  const [retryCount, setRetryCount] = React.useState(0);

  React.useEffect(() => {
    return () => {
      stems.forEach((s) => URL.revokeObjectURL(s.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      toast.error("文件过大（>50MB）。Demucs 公共 Space 处理较慢，建议先压缩 / 截取片段");
      return;
    }
    setFile(f);
    stems.forEach((s) => URL.revokeObjectURL(s.url));
    setStems([]);
  };

  const onSubmit = async () => {
    if (!file) {
      toast.error("请先选择音频文件");
      return;
    }
    setBusy(true);
    setStems([]);
    setProgress("检测网络...");
    try {
      try {
        await checkHfReachable();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "HF Space 不可达");
        setBusy(false);
        setProgress("");
        return;
      }

      setProgress("提交任务...");
      // Gradio 文件入参格式：{ path: <url-or-data-url>, meta: { _type: "gradio.FileData" } }
      const dataUrl = await fileToDataUrl(file);
      const fileInput = {
        path: dataUrl,
        meta: { _type: "gradio.FileData" },
        orig_name: file.name,
      };

      setProgress(`分离中（约 30-90 秒）${retryCount > 0 ? ` · 第 ${retryCount + 1} 次` : ""}...`);
      // ZeroGPU 排队是常态，给到 3 次自动重试（间隔 1.5s → 3s → 6s）
      const result = await callHfSpaceWithRetry<unknown>(spaceId, "/predict", [fileInput], 5 * 60_000, 3);

      const parsed = await parseStemsResult(result);
      if (parsed.length === 0) throw new Error("Space 返回结果格式无法识别");
      setStems(parsed);
      setRetryCount(0);
      toast.success(`分离完成 · ${parsed.length} 轨`);
    } catch (e) {
      if (e instanceof HfTransientError) {
        toast.error("HF 公共 Space 资源紧张", {
          description: "免费 ZeroGPU 排队拥堵 —— 已自动重试 3 次仍失败。可点「重试」、换个 Space 或稍后再来。",
          duration: 8000,
        });
        setRetryCount((n) => n + 1);
      } else {
        toast.error(e instanceof Error ? e.message : "分离失败");
        setRetryCount(0);
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="text-xs">音频文件</Label>
          {!file ? (
            <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface-1 py-12 hover:bg-secondary/30">
              <Upload className="size-6 text-muted-foreground" />
              <span className="mt-2 text-sm">点击选择文件</span>
              <span className="mt-1 text-[11px] text-muted-foreground">支持 mp3 / wav · 推荐 ≤ 50MB（公共 Space 限制）</span>
              <input type="file" accept="audio/*" className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
              <FileAudio className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || "未知"}
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setFile(null)} disabled={busy}>
                <X className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              <div className="font-medium">Demucs · 人声分离</div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                facebookresearch/demucs Hybrid Transformer · HuggingFace 公共 Space
              </div>
            </div>
            <Button variant="brand" size="lg" onClick={onSubmit} disabled={busy || !file} className="min-w-32 shrink-0">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Music className="size-4" />}
              {busy ? (progress || "处理中...") : retryCount > 0 ? `重试（已失败 ${retryCount} 次）` : "开始分离"}
            </Button>
          </div>

          {/* Space 切换 */}
          <div className="mt-3 grid gap-2">
            <Label className="text-[11px] text-muted-foreground">Space 来源（拥堵时换一个）</Label>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              disabled={busy}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {SPACES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {stems.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] text-muted-foreground">分离结果 · {stems.length} 轨</span>
              <Button variant="ghost" size="sm" title="清空全部"
                onClick={() => {
                  stems.forEach((s) => URL.revokeObjectURL(s.url));
                  setStems([]);
                }}>
                <Trash2 className="size-3.5" /> 清空
              </Button>
            </div>
            {stems.map((s) => (
              <div key={s.name} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant="brand" className="text-[10px]">{STEM_LABELS[s.name]}</Badge>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {(s.blob.size / 1024 / 1024).toFixed(1)} MB · {s.blob.type || "audio"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={s.url} download={`${s.name}.wav`} className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs hover:bg-secondary">
                      <Download className="size-3.5" /> 下载
                    </a>
                    <Button variant="ghost" size="icon-sm" title="删除该轨"
                      onClick={() => {
                        URL.revokeObjectURL(s.url);
                        setStems((prev) => prev.filter((x) => x.name !== s.name));
                      }}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <audio src={s.url} controls className="mt-3 w-full" preload="metadata" />
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-4 text-[11px] text-muted-foreground">
          <div className="mb-1 text-foreground font-medium">输出说明</div>
          <ul className="space-y-1 ps-3 list-disc list-outside">
            <li>4 轨独立 wav，可单独下载 / 试听</li>
            <li>典型耗时 30-90 秒（取决于公共 Space 排队）</li>
            <li>建议先截取 1 分钟内片段试，避免上传等待过久</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}

/* ─── helpers ─── */

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("文件读取失败"));
    r.onload = () => resolve(r.result as string);
    r.readAsDataURL(f);
  });
}

/**
 * 不同 Demucs Space 返回结构略有差异，常见三种：
 *   A. [{path|url}, {path|url}, {path|url}, {path|url}]   按 [vocals, drums, bass, other] 顺序
 *   B. { vocals: {url}, drums: {url}, bass: {url}, other: {url} }
 *   C. 单个 zip 文件 → 不支持
 *
 * normalize 后的 path/url 已经是绝对 URL（hf-direct.normalizeResult 会做这个）。
 */
async function parseStemsResult(raw: unknown): Promise<Stem[]> {
  const stems: Stem[] = [];
  const order: Stem["name"][] = ["vocals", "drums", "bass", "other"];

  const fetchAsBlob = async (urlOrPath: string): Promise<Blob> => {
    if (urlOrPath.startsWith("data:")) {
      const r = await fetch(urlOrPath);
      return r.blob();
    }
    const r = await fetch(urlOrPath);
    if (!r.ok) throw new Error(`下载分轨失败 ${r.status}`);
    return r.blob();
  };

  const extractUrl = (v: unknown): string | null => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as { url?: string; path?: string; data?: string };
      return o.url ?? o.path ?? o.data ?? null;
    }
    return null;
  };

  if (Array.isArray(raw)) {
    for (let i = 0; i < Math.min(raw.length, order.length); i++) {
      const u = extractUrl(raw[i]);
      if (!u) continue;
      const blob = await fetchAsBlob(u);
      const url = URL.createObjectURL(blob);
      stems.push({ name: order[i], label: order[i], url, blob });
    }
  } else if (raw && typeof raw === "object") {
    const dict = raw as Record<string, unknown>;
    for (const name of order) {
      const u = extractUrl(dict[name]);
      if (!u) continue;
      const blob = await fetchAsBlob(u);
      const url = URL.createObjectURL(blob);
      stems.push({ name, label: name, url, blob });
    }
  }

  return stems;
}
