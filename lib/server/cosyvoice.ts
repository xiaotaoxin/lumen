/**
 * CosyVoice 2 服务端中继。
 *
 * 阿里百炼 CosyVoice 是 WebSocket 协议（streaming TTS），不能 HTTP REST 直接调。
 * 我们在 Node 服务端起一个 WebSocket client，用 lumen.db 里加密的百炼 sk-... 鉴权，
 * 收齐音频 chunk 后整体返回给浏览器。这样客户端永远不见 Key。
 *
 * Key 复用：CosyVoice 用百炼 sk-...，与通义万相 / 千问 / 第三方共用同一份。
 * 这里不要求 admin 单独配 cosyvoice 模型，会自动找数据库里任一 bailian-* 家族模型解密拿 Key。
 *
 * 协议参考：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 */

import * as crypto from "node:crypto";
import WebSocket from "ws";
import { getDb } from "./db";
import { decryptApiKey } from "./crypto";

const WSS_URL_CN = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";

/**
 * 从 lumen.db 里随便找一份百炼 Key 解密返回。
 * 没有任何配过百炼的模型时返回 null —— 调用方负责给 401 / 提示去 admin 配。
 */
export function resolveBailianApiKey(): string | null {
  const row = getDb()
    .prepare<[], { api_key_encrypted: string }>(
      `SELECT api_key_encrypted FROM models
       WHERE provider_type IN ('bailian-tongyi', 'bailian-qwen', 'bailian-thirdparty', 'dashscope-image', 'dashscope-video')
         AND api_key_encrypted IS NOT NULL
       LIMIT 1`,
    )
    .get();
  if (!row) return null;
  try {
    return decryptApiKey(row.api_key_encrypted);
  } catch (err) {
    console.error("[cosyvoice] 解密百炼 Key 失败:", (err as Error).message);
    return null;
  }
}

export interface SynthesizeOptions {
  text: string;
  /** voice 预设音色名（如 longanyang）或声音复刻拿到的 voice_id */
  voice: string;
  /** cosyvoice-v3.5-plus / cosyvoice-v3-flash / cosyvoice-v2 等 */
  model?: string;
  /** mp3 (默认) / wav / pcm / opus */
  format?: "mp3" | "wav" | "pcm" | "opus";
  sampleRate?: number;
  volume?: number;
  rate?: number;
  pitch?: number;
}

export interface SynthesizeResult {
  /** 完整音频字节 */
  audio: Buffer;
  /** 实际格式（透传 options.format，默认 mp3） */
  format: string;
  /** 实际采样率 */
  sampleRate: number;
  /** 上游计费字符数（CosyVoice 按字符计费） */
  characters?: number;
  durationMs: number;
}

const DEFAULT_MODEL = "cosyvoice-v3-flash";
const DEFAULT_VOICE = "longanyang";
const SYNTHESIZE_TIMEOUT_MS = 60_000;

/**
 * 一次性合成（阻塞直到 task-finished）。返回完整音频 Buffer。
 * 内部协议：run-task → continue-task(text) → finish-task → 收齐 binary frames → task-finished
 */
export async function synthesizeOnce(
  apiKey: string,
  opts: SynthesizeOptions,
): Promise<SynthesizeResult> {
  const t0 = Date.now();
  const model = opts.model ?? DEFAULT_MODEL;
  const voice = opts.voice ?? DEFAULT_VOICE;
  const format = opts.format ?? "mp3";
  const sampleRate = opts.sampleRate ?? 22050;
  const taskId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    let characters = 0;
    let resolved = false;

    const ws = new WebSocket(WSS_URL_CN, {
      headers: { Authorization: `bearer ${apiKey}` },
    });

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { /* noop */ }
      reject(new Error(`CosyVoice 超时 (${SYNTHESIZE_TIMEOUT_MS}ms)`));
    }, SYNTHESIZE_TIMEOUT_MS);

    const settle = (err: Error | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      if (err) reject(err);
      else {
        resolve({
          audio: Buffer.concat(audioChunks),
          format,
          sampleRate,
          characters: characters || undefined,
          durationMs: Date.now() - t0,
        });
      }
    };

    ws.on("open", () => {
      const runTask = {
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio",
          task: "tts",
          function: "SpeechSynthesizer",
          model,
          parameters: {
            text_type: "PlainText",
            voice,
            format,
            sample_rate: sampleRate,
            volume: opts.volume ?? 50,
            rate: opts.rate ?? 1.0,
            pitch: opts.pitch ?? 1.0,
            enable_ssml: false,
          },
          input: {},
        },
      };
      ws.send(JSON.stringify(runTask));
    });

    ws.on("message", (msg, isBinary) => {
      if (isBinary || Buffer.isBuffer(msg) && !looksLikeJson(msg)) {
        // 二进制音频帧
        audioChunks.push(Buffer.isBuffer(msg) ? msg : Buffer.from(msg as ArrayBuffer));
        return;
      }
      const text = msg.toString();
      let evt: { header?: { event?: string; error_message?: string }; payload?: { usage?: { characters?: number } } };
      try {
        evt = JSON.parse(text);
      } catch {
        return;
      }
      const event = evt.header?.event;
      if (event === "task-started") {
        // 紧接着送文本 + finish
        const continueMsg = {
          header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
          payload: { input: { text: opts.text } },
        };
        ws.send(JSON.stringify(continueMsg));
        const finishMsg = {
          header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
          payload: { input: {} },
        };
        ws.send(JSON.stringify(finishMsg));
      } else if (event === "result-generated") {
        const c = evt.payload?.usage?.characters;
        if (typeof c === "number") characters = Math.max(characters, c);
      } else if (event === "task-finished") {
        settle(null);
      } else if (event === "task-failed") {
        settle(new Error(evt.header?.error_message ?? "CosyVoice 任务失败"));
      }
    });

    ws.on("error", (err) => settle(err as Error));
    ws.on("close", () => {
      if (!resolved) settle(new Error("CosyVoice 连接被异常关闭"));
    });
  });
}

/** 简单启发：JSON 必以 `{` 开头（utf-8）。CosyVoice 二进制帧是 mp3 / wav / pcm 字节流。 */
function looksLikeJson(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const first = buf[0];
  return first === 0x7b /* { */ || first === 0x5b /* [ */;
}

/* ───── 声音复刻（HTTP REST） ───── */

const REST_BASE = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization";

export interface CloneVoiceOptions {
  /** 公网可访问的 wav URL（5~30 秒、16kHz 推荐） */
  audioUrl: string;
  /** 声音前缀，如 "myvoice"，最终生成 voice_id 形如 myvoice-xxx */
  prefix: string;
  /** 目标合成模型；该 voice_id 之后只能搭配该模型用 */
  targetModel?: string;
  /** zh / en / ja / ko 等 */
  languageHints?: string[];
}

export async function createClonedVoice(
  apiKey: string,
  opts: CloneVoiceOptions,
): Promise<{ voiceId: string; raw: unknown }> {
  const body = {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: opts.targetModel ?? DEFAULT_MODEL,
      prefix: opts.prefix,
      url: opts.audioUrl,
      language_hints: opts.languageHints ?? ["zh"],
    },
  };
  const res = await fetch(REST_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const message = (json as { message?: string }).message ?? `HTTP ${res.status}`;
    throw new Error(`声音复刻失败: ${message}`);
  }
  const voiceId = (json as { output?: { voice_id?: string } }).output?.voice_id;
  if (!voiceId) {
    throw new Error("声音复刻接口未返回 voice_id");
  }
  return { voiceId, raw: json };
}
