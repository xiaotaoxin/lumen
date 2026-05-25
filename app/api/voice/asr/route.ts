/**
 * /api/voice/asr  —  录音文件识别
 *
 * 阿里百炼 ASR 有两条路径：
 *   1) 同步 multimodal-generation —— 接受 base64 dataURL，适合短音频，返回纯文本（无时间戳）
 *   2) 异步 transcription          —— 仅接受公网 https URL，返回带 sentences[] 时间戳，可生成 SRT
 *
 * 路由根据入参自动分流：
 *   - body.dataUrl   → 同步接口
 *   - body.fileUrl   → 异步接口 + 服务端轮询
 *
 * Key 复用 lumen.db 里 bailian-* 家族任一记录的 sk-...
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveBailianApiKey } from "@/lib/server/cosyvoice";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYNC_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const ASYNC_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const POLL_BASE  = "https://dashscope.aliyuncs.com/api/v1/tasks";
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 4 * 60_000;

interface Body {
  dataUrl?: string;
  fileUrl?: string;
  fileName?: string;
  languageHints?: string[];
}

interface SentenceOut {
  begin_time: number;
  end_time: number;
  text: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const apiKey = resolveBailianApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置百炼 API Key", detail: "请到 /admin/models 给 bailian-* 家族保存 sk-... Key" },
      { status: 401 },
    );
  }

  // 路径分流
  if (body.fileUrl) {
    return handleAsync(apiKey, body.fileUrl, body.languageHints);
  }
  if (body.dataUrl) {
    return handleSync(apiKey, body.dataUrl, body.languageHints);
  }
  return NextResponse.json({ error: "需要 dataUrl 或 fileUrl 之一" }, { status: 400 });
}

/* ─── 同步：base64 → multimodal-generation ─── */

async function handleSync(apiKey: string, dataUrl: string, languageHints?: string[]) {
  const t0 = Date.now();
  try {
    const submitBody: Record<string, unknown> = {
      model: "qwen3-asr-flash",
      input: {
        messages: [{
          role: "user",
          content: [{ audio: dataUrl }],
        }],
      },
    };
    if (languageHints && languageHints.length > 0) {
      submitBody.parameters = { asr_options: { language: languageHints[0] } };
    }

    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(submitBody),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[asr/sync] fail", res.status, text.slice(0, 400));
      // 透传上游错误，附带友好建议
      return NextResponse.json(
        {
          error: extractFriendlyError(text, res.status),
          hint: "短音频（≤ 30s）走同步接口；长音频请改用「公网 URL」入口（异步接口能生成 SRT）",
        },
        { status: 502 },
      );
    }
    const json = (await res.json()) as {
      output?: {
        choices?: Array<{
          message?: {
            content?: Array<{ text?: string }>;
          };
        }>;
      };
      usage?: { audio_tokens?: number };
    };
    const text = json.output?.choices?.[0]?.message?.content
      ?.map((c) => c.text ?? "")
      .filter(Boolean)
      .join("") ?? "";
    if (!text) {
      return NextResponse.json(
        { error: "上游未返回识别结果（音频可能太短或无人声）" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      text,
      segments: [] as SentenceOut[],   // 同步接口无时间戳；UI 应隐藏 SRT 下载
      durationMs: Date.now() - t0,
      mode: "sync",
    });
  } catch (e) {
    console.error("[asr/sync] uncaught", e);
    return NextResponse.json({ error: (e as Error).message ?? "识别失败" }, { status: 500 });
  }
}

/* ─── 异步：公网 URL → transcription + 轮询 ─── */

async function handleAsync(apiKey: string, fileUrl: string, languageHints?: string[]) {
  const t0 = Date.now();
  try {
    const submitBody = {
      model: "qwen3-asr-flash-filetrans",
      input: { file_urls: [fileUrl] },
      parameters: {
        ...(languageHints && languageHints.length > 0 ? { language_hints: languageHints } : {}),
        enable_words: true,
      },
    };
    const submit = await fetch(ASYNC_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(submitBody),
    });
    if (!submit.ok) {
      const text = await submit.text().catch(() => "");
      console.error("[asr/async] submit fail", submit.status, text.slice(0, 400));
      return NextResponse.json(
        { error: extractFriendlyError(text, submit.status) },
        { status: 502 },
      );
    }
    const submitJson = (await submit.json()) as {
      output?: { task_id?: string };
    };
    const taskId = submitJson.output?.task_id;
    if (!taskId) {
      return NextResponse.json({ error: "阿里未返回 task_id" }, { status: 502 });
    }

    let result: TaskOutput | null = null;
    while (Date.now() - t0 < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);
      const poll = await fetch(`${POLL_BASE}/${taskId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!poll.ok) continue;
      const j = (await poll.json()) as { output?: TaskOutput };
      const out = j.output;
      if (!out) continue;
      if (out.task_status === "SUCCEEDED" || out.task_status === "FAILED" || out.task_status === "CANCELED") {
        result = out;
        break;
      }
    }
    if (!result) {
      return NextResponse.json(
        { error: `识别超时（${Math.floor(MAX_WAIT_MS / 1000)}s 内未完成）` },
        { status: 504 },
      );
    }
    if (result.task_status !== "SUCCEEDED") {
      return NextResponse.json(
        { error: `识别失败：${result.message ?? result.task_status}` },
        { status: 502 },
      );
    }

    const allSentences: SentenceOut[] = [];
    const fullTextParts: string[] = [];
    let detectedLang: string | undefined;

    for (const r of result.results ?? []) {
      const list: Transcript[] = [];
      if (r.transcripts) list.push(...r.transcripts);
      else if (r.transcription_url) {
        const det = await fetch(r.transcription_url).catch(() => null);
        if (det && det.ok) {
          const dj = await det.json().catch(() => null) as { transcripts?: Transcript[] } | null;
          if (dj?.transcripts) list.push(...dj.transcripts);
        }
      }
      for (const t of list) {
        detectedLang ??= t.lang;
        if (Array.isArray(t.sentences)) {
          for (const s of t.sentences) {
            allSentences.push({
              begin_time: s.begin_time ?? 0,
              end_time: s.end_time ?? 0,
              text: s.text ?? "",
            });
            fullTextParts.push(s.text ?? "");
          }
        } else if (t.text) {
          fullTextParts.push(t.text);
        }
      }
    }

    return NextResponse.json({
      text: fullTextParts.join("").trim(),
      segments: allSentences,
      durationMs: Date.now() - t0,
      language: detectedLang,
      mode: "async",
    });
  } catch (e) {
    console.error("[asr/async] uncaught", e);
    return NextResponse.json({ error: (e as Error).message ?? "识别失败" }, { status: 500 });
  }
}

/* ─── helpers ─── */

interface Sentence { begin_time?: number; end_time?: number; text?: string }
interface Transcript { lang?: string; sentences?: Sentence[]; text?: string }
interface ResultItem { transcripts?: Transcript[]; transcription_url?: string }
interface TaskOutput {
  task_id?: string;
  task_status?: string;
  message?: string;
  results?: ResultItem[];
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function extractFriendlyError(body: string, status: number): string {
  try {
    const j = JSON.parse(body) as { message?: string; code?: string };
    if (j.message) return `${j.code ?? "上游错误"}: ${j.message}`;
  } catch { /* not JSON */ }
  if (status === 401) return "百炼 API Key 无效或权限不足";
  if (status === 403) return "百炼拒绝请求（可能是模型未开通）";
  if (status === 429) return "请求过于频繁，请稍后再试";
  return `阿里 ASR 失败 (HTTP ${status})`;
}
