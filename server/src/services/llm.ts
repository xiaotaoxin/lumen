/**
 * LLM adapter — DashScope Qwen (primary) + OpenAI-compatible (fallback).
 * Used for prompt polishing, script analysis, etc.
 *
 * API key resolution: reuses bailian credentials from the models table.
 */

const DEFAULT_MODEL = "qwen-plus";

interface LlmConfig {
  provider: "dashscope" | "openai";
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  messages: ChatMessage[],
  config: LlmConfig,
): Promise<string> {
  if (config.provider === "dashscope") {
    return chatDashScope(messages, config);
  }
  return chatOpenAI(messages, config);
}

async function chatDashScope(
  messages: ChatMessage[],
  config: LlmConfig,
): Promise<string> {
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DashScope LLM error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content || "";
}

async function chatOpenAI(
  messages: ChatMessage[],
  config: LlmConfig,
): Promise<string> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI LLM error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Resolve an LLM API key from:
 * 1. Env var LLM_API_KEY + LLM_PROVIDER
 * 2. First available bailian-family model in the DB
 */
export function resolveLlmConfig(): LlmConfig | null {
  const db = (globalThis as Record<string, unknown>).__lumenServerDb as
    | { prepare: (sql: string) => { get: (...args: unknown[]) => { api_key_encrypted?: string } | undefined } }
    | undefined;

  // Try env var first
  if (process.env.LLM_API_KEY) {
    return {
      provider: (process.env.LLM_PROVIDER as "openai" | "dashscope") || "openai",
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
      baseUrl: process.env.LLM_BASE_URL,
    };
  }

  // Fallback: find a bailian model in the DB that has a key
  if (db) {
    const row = db.prepare(
      "SELECT api_key_encrypted FROM models WHERE provider_type LIKE 'bailian%' AND enabled = 1 AND api_key_encrypted IS NOT NULL LIMIT 1",
    ).get();
    if (row?.api_key_encrypted) {
      try {
        const { decryptApiKey } = require("../../../lib/server/crypto");
        return {
          provider: "dashscope",
          apiKey: decryptApiKey(row.api_key_encrypted),
          model: DEFAULT_MODEL,
        };
      } catch { /* fall through */ }
    }
  }

  return null;
}

/* ──────── Prompt Polish ──────── */

const POLISH_SYSTEM_IMAGE = `You are an expert prompt engineer for AI image generation models (e.g., Flux, DALL-E, Midjourney, Stable Diffusion).

Your task: given a user's image description in any language, produce a polished English prompt optimized for AI image generation.

Rules:
- Output ONLY the polished prompt text, no explanations.
- Keep it under 200 words.
- Include: subject, medium/style, lighting, composition, color palette, mood.
- If the input is Chinese, translate key concepts faithfully.
- Use natural English — avoid comma-separated keyword spam.
- Add artistic style cues (e.g. "cinematic lighting", "oil painting texture", "photorealistic") only if appropriate.`;

const POLISH_SYSTEM_VIDEO = `You are an expert prompt engineer for AI video generation models (e.g., Kling, Runway, Wan).

Your task: given a user's video description in any language, produce a polished English prompt optimized for AI video generation.

Rules:
- Output ONLY the polished prompt text, no explanations.
- Keep it under 200 words.
- Include: subject action/motion, camera movement, lighting, mood, scene composition.
- Describe the motion and camera work explicitly (e.g. "slow pan", "dolly zoom", "static shot with subtle character movement").
- If the input is Chinese, translate key concepts faithfully.
- Use natural cinematic English.`;

export async function polishPrompt(
  userPrompt: string,
  kind: "image" | "video",
  config: LlmConfig,
): Promise<{ polished: string }> {
  const systemPrompt = kind === "video" ? POLISH_SYSTEM_VIDEO : POLISH_SYSTEM_IMAGE;
  const result = await chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config,
  );
  return { polished: result.trim() };
}
