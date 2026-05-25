// MiniMax 海螺 proxy。
// 浏览器送 X-Lumen-API-Key（MiniMax API Key），proxy 改写为
// Authorization: Bearer。
//
// 流量主要是三段式异步：
//   POST /v1/video_generation             创建任务
//   GET  /v1/query/video_generation       轮询状态
//   GET  /v1/files/retrieve               拿到 download_url

import { NextRequest, NextResponse } from "next/server";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM = "https://api.minimax.io";

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
      { code: "MissingApiKey", message: "missing X-Lumen-Model-Id or X-Lumen-API-Key" },
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
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { code: "UpstreamFetchFailed", message: `upstream fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // Strip content-encoding AND content-length to avoid double-decode (Node fetch
  // auto-decompresses upstream gzip, browser would try to decode plaintext as
  // gzip → "Failed to fetch").
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
