// Stage-1 OpenAI proxy. The browser sends the user-supplied API key in the
// X-Lumen-API-Key header; we strip it here, then re-attach it as a real
// Authorization: Bearer header to api.openai.com. Two reasons it matters:
//   1) Bypasses the CORS wall — the browser can't talk to api.openai.com
//      directly from a localhost / preview domain.
//   2) The upstream key never appears in network logs visible to other
//      tabs / extensions / devtools of unrelated users.
//
// Caveat: the key still travels from the user's own browser to this proxy
// over plain HTTP (in dev). Stage 3 moves keys into the DB and the browser
// stops carrying them at all.

import { NextRequest, NextResponse } from "next/server";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM = "https://api.openai.com";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Strip these so the upstream sees a clean request.
  "host",
  "x-lumen-api-key",
  "x-lumen-model-id",
  "cookie",
]);

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const auth = resolveProxyAuth(req);
  if (!auth) {
    return NextResponse.json(
      { error: { message: "missing X-Lumen-Model-Id or X-Lumen-API-Key" } },
      { status: 401 },
    );
  }
  const apiKey = auth.apiKey;

  const targetUrl = new URL(`${UPSTREAM}/${path.join("/")}`);
  // Pass query params through.
  req.nextUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Authorization", `Bearer ${apiKey}`);

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      // Avoid Next.js fetch caching for upstream calls.
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: `upstream fetch failed: ${(err as Error).message}` } },
      { status: 502 },
    );
  }

  // Mirror upstream response back to the caller. Strip hop-by-hop headers,
  // plus content-encoding (Node's fetch already decompressed the body —
  // forwarding the encoding header would make the browser double-decode and
  // throw "Failed to fetch") and content-length (size changed for same reason).
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "content-length" || lower === "content-encoding") return;
    respHeaders.set(key, value);
  });
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const runtime = "nodejs";
