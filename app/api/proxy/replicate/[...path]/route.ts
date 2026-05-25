// Stage-1 Replicate proxy. Same pattern as the OpenAI proxy:
// browser sends X-Lumen-API-Key, we strip it and re-attach as
// `Authorization: Token <key>` (Replicate uses `Token`, not `Bearer`).
//
// Replicate predictions are async — the browser will hit this proxy at
// least twice per generation (POST /v1/predictions, then poll
// /v1/predictions/{id}). All paths flow through here.

import { NextRequest, NextResponse } from "next/server";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM = "https://api.replicate.com";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
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
      { detail: "missing X-Lumen-Model-Id or X-Lumen-API-Key" },
      { status: 401 },
    );
  }
  const apiKey = auth.apiKey;

  const targetUrl = new URL(`${UPSTREAM}/${path.join("/")}`);
  req.nextUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Authorization", `Token ${apiKey}`);

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
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { detail: `upstream fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Strip content-encoding + content-length: Node's fetch auto-decompresses
  // the upstream body, so forwarding either header would make the browser
  // double-decode and fail with "TypeError: Failed to fetch".
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
