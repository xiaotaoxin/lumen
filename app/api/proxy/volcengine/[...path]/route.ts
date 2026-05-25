// Volcengine（火山引擎）proxy —— 支持即梦 / 智能视觉服务等。
//
// 火山引擎用 V4 签名（HMAC-SHA256），不能像 Bearer Key 那样浏览器直接送。
// 本 proxy 在服务端做签名：
//   - 浏览器送 X-Lumen-API-Key: "<AccessKey>:<SecretKey>"（冒号分隔）
//   - proxy 把 AK/SK 拆开，按 V4 算法生成 Authorization 头转发
//
// 默认目标：visual.volcengineapi.com（智能视觉服务）
//   - Service: "cv"
//   - Region:  "cn-north-1"
//   - Query:   ?Action=CVProcess&Version=2022-08-31
//
// 用法：浏览器 fetch /api/proxy/volcengine/?Action=CVProcess&Version=...
// 即可，proxy 会把 path 后面的 URL 转给上游。

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const UPSTREAM_HOST = "visual.volcengineapi.com";
const SERVICE = "cv";
const REGION = "cn-north-1";

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
  "authorization",
  "x-date",
  "x-content-sha256",
]);

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function getXDate(now: Date): string {
  // YYYYMMDDTHHMMSSZ
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

function signRequest(opts: {
  method: string;
  pathname: string;
  search: string;
  body: Buffer;
  contentType: string;
  accessKey: string;
  secretKey: string;
}): { authorization: string; xDate: string; xContentSha256: string; host: string } {
  const now = new Date();
  const xDate = getXDate(now);
  const date = xDate.slice(0, 8); // YYYYMMDD
  const xContentSha256 = sha256Hex(opts.body);

  // Canonical request
  // 火山引擎签 host / x-content-sha256 / x-date / content-type
  const signedHeadersList = ["content-type", "host", "x-content-sha256", "x-date"];
  const canonicalHeaders = [
    `content-type:${opts.contentType}`,
    `host:${UPSTREAM_HOST}`,
    `x-content-sha256:${xContentSha256}`,
    `x-date:${xDate}`,
  ].join("\n") + "\n";
  const signedHeaders = signedHeadersList.join(";");

  // Canonical query: search 已经是 "?a=1&b=2" 格式，去掉前导 "?"，并按 key 排序
  const queryPairs = opts.search.replace(/^\?/, "")
    .split("&")
    .filter((s) => s.length > 0)
    .map((s) => {
      const eq = s.indexOf("=");
      const k = eq >= 0 ? s.slice(0, eq) : s;
      const v = eq >= 0 ? s.slice(eq + 1) : "";
      return [k, v] as [string, string];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQuery = queryPairs.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalRequest = [
    opts.method.toUpperCase(),
    opts.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    xContentSha256,
  ].join("\n");

  const credentialScope = `${date}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(opts.secretKey, date);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, xDate, xContentSha256, host: UPSTREAM_HOST };
}

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
  const colonIdx = apiKey.indexOf(":");
  if (colonIdx < 0) {
    return NextResponse.json(
      { code: "InvalidKeyFormat", message: "Volcengine 需要 AccessKey:SecretKey 形式（冒号分隔）" },
      { status: 401 },
    );
  }
  const accessKey = apiKey.slice(0, colonIdx).trim();
  const secretKey = apiKey.slice(colonIdx + 1).trim();
  if (!accessKey || !secretKey) {
    return NextResponse.json({ code: "InvalidKeyFormat", message: "AccessKey 或 SecretKey 为空" }, { status: 401 });
  }

  const targetPath = `/${path.join("/")}`;
  const targetUrl = new URL(`https://${UPSTREAM_HOST}${targetPath}`);
  req.nextUrl.searchParams.forEach((v, k) => targetUrl.searchParams.set(k, v));

  const bodyBuf: Buffer = req.method === "GET" || req.method === "HEAD"
    ? Buffer.alloc(0)
    : Buffer.from(await req.arrayBuffer());
  const contentType = req.headers.get("content-type") ?? "application/json";

  const { authorization, xDate, xContentSha256 } = signRequest({
    method: req.method,
    pathname: targetUrl.pathname,
    search: targetUrl.search,
    body: bodyBuf,
    contentType,
    accessKey,
    secretKey,
  });

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Host", UPSTREAM_HOST);
  headers.set("Content-Type", contentType);
  headers.set("X-Date", xDate);
  headers.set("X-Content-Sha256", xContentSha256);
  headers.set("Authorization", authorization);

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyBuf.length === 0 ? undefined : new Uint8Array(bodyBuf),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { code: "UpstreamFetchFailed", message: `upstream fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

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
