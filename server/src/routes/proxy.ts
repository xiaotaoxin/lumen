import { Hono } from "hono";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

// Import server-side modules for credential resolution
import { resolvePlaintextApiKey } from "../../../lib/server/models-store";

const proxy = new Hono<{ Variables: AuthVariables }>();
proxy.use("*", auth);

/**
 * Generic proxy handler for AI provider upstream calls.
 *
 * Frontend calls: POST /api/proxy/call with { upstream, path, method, body? }
 * Backend resolves API key from the stored model, then forwards to the upstream.
 *
 * Key safety: strips content-encoding and content-length from upstream responses
 * to prevent browser from double-decoding gzip.
 */

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
  "x-lumen-api-key", "x-lumen-model-id", "cookie",
]);

proxy.all("/call", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { upstream, path, method, body: upstreamBody, modelId, apiKey: plainKey } = body;

  if (!upstream) return c.json({ code: "INVALID_INPUT", message: "缺少 upstream URL" }, 400);

  // Resolve API key: prefer plainKey (test call), then modelId (stored key)
  let apiKey = plainKey;
  if (!apiKey && modelId) {
    apiKey = resolvePlaintextApiKey(modelId);
  }
  if (!apiKey) {
    return c.json({ code: "MissingApiKey", message: "未配置 API Key" }, 401);
  }

  const targetUrl = new URL(`${upstream.replace(/\/$/, "")}/${(path || "").replace(/^\//, "")}`);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${apiKey}`);

  const t0 = Date.now();
  let upstreamResp: Response;
  try {
    upstreamResp = await fetch(targetUrl, {
      method: method || "POST",
      headers,
      body: upstreamBody ? JSON.stringify(upstreamBody) : undefined,
    });
  } catch (err) {
    console.error(`[proxy] ${method || "POST"} ${targetUrl.hostname} → FAIL: ${(err as Error).message}`);
    return c.json({ code: "UpstreamFetchFailed", message: (err as Error).message }, 502);
  }

  console.log(`[proxy] ${method || "POST"} ${targetUrl.hostname}${targetUrl.pathname} ← ${upstreamResp.status} in ${Date.now() - t0}ms`);

  // Strip hop-by-hop headers and content-encoding
  const respHeaders = new Headers();
  upstreamResp.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "content-length" || lower === "content-encoding") return;
    respHeaders.set(key, value);
  });

  const respBody = await upstreamResp.text();
  return new Response(respBody, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: respHeaders,
  });
});

export default proxy;
