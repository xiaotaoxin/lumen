// 火山方舟 Ark proxy —— 用于豆包 Seedream / Seedance 等大模型。
//
// 与即梦的智能视觉服务（visual.volcengineapi.com + V4 签名）是两条路径：
// 方舟用 Bearer Token 鉴权（单一 ARK_API_KEY），格式与 OpenAI 兼容。
//
// 浏览器送 X-Lumen-API-Key（火山方舟 API Key），proxy 改写为 Authorization: Bearer。

import { NextRequest, NextResponse } from "next/server";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM = "https://ark.cn-beijing.volces.com";

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

  // Strip content-encoding + content-length to avoid double-decode（同其它 proxy）
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
