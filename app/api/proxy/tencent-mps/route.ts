// 腾讯云 MPS 媒体处理 proxy（TC3-HMAC-SHA256 签名）。
//
// 浏览器侧通过自定义头送来：
//   X-Lumen-API-Key: <SecretId>:<SecretKey>
//   X-TC-Action:    具体 Action 名（ProcessMedia / DescribeTasks ...）
//   X-TC-Version:   API 版本（默认 2019-06-12）
//   X-TC-Region:    区域（如 ap-shanghai）
// Body 是腾讯云 API 的 JSON payload。
//
// 本 proxy 服务端做完整 TC3 签名后转发到 mps.tencentcloudapi.com。

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolveProxyAuth } from "@/lib/server/proxy-auth";

const HOST = "mps.tencentcloudapi.com";
const SERVICE = "mps";

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

/**
 * TC3-HMAC-SHA256 签名。腾讯云签名规范：
 * https://cloud.tencent.com/document/api/213/30654
 */
function signTc3(opts: {
  secretId: string;
  secretKey: string;
  action: string;
  version: string;
  region: string;
  body: string;
  timestamp: number;
}): { authorization: string; date: string } {
  const ts = opts.timestamp;
  const date = new Date(ts * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD（UTC）

  // 1) Canonical request
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${opts.action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedPayload = sha256Hex(opts.body);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join("\n");

  // 2) String to sign
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(ts),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // 3) Signing key chain: HMAC(HMAC(HMAC("TC3"+SK, date), service), "tc3_request")
  const kDate = hmac(`TC3${opts.secretKey}`, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, "tc3_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `TC3-HMAC-SHA256 Credential=${opts.secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, date };
}

export async function POST(req: NextRequest) {
  const auth = resolveProxyAuth(req);
  if (!auth || !auth.apiKey.includes(":")) {
    return NextResponse.json(
      { Response: { Error: { Code: "MissingApiKey", Message: "缺少 SecretId:SecretKey（X-Lumen-Model-Id 或 X-Lumen-API-Key 头）" } } },
      { status: 401 },
    );
  }
  const apiKey = auth.apiKey;
  // 拿到 "secretId:secretKey"。再次 trim 防尾部空格
  const colonIdx = apiKey.indexOf(":");
  const secretId = (colonIdx >= 0 ? apiKey.slice(0, colonIdx) : "").trim();
  const secretKey = (colonIdx >= 0 ? apiKey.slice(colonIdx + 1) : "").trim();
  const action = req.headers.get("x-tc-action");
  const version = req.headers.get("x-tc-version") ?? "2019-06-12";
  const region = (req.headers.get("x-tc-region") ?? "ap-shanghai").trim();
  if (!action) {
    return NextResponse.json(
      { Response: { Error: { Code: "MissingAction", Message: "缺少 X-TC-Action 头" } } },
      { status: 400 },
    );
  }
  if (!secretId || !secretKey) {
    return NextResponse.json(
      { Response: { Error: { Code: "InvalidApiKey", Message: "SecretId 或 SecretKey 为空" } } },
      { status: 401 },
    );
  }
  // SecretId 必须以 AKID 开头（腾讯云 V3 规范），否则提前拦掉，给一条更友好的提示
  if (!secretId.startsWith("AKID")) {
    return NextResponse.json(
      {
        Response: {
          Error: {
            Code: "InvalidApiKey.Format",
            Message: `腾讯云 SecretId 应以 "AKID" 开头（共 36 字符），收到的前 8 位是 "${secretId.slice(0, 8)}"。请到 console.cloud.tencent.com/cam/capi 重新复制完整密钥；注意不要把 APPID（纯数字）粘到 SecretId 字段。`,
          },
        },
      },
      { status: 401 },
    );
  }

  const bodyBuf = Buffer.from(await req.arrayBuffer());
  const bodyStr = bodyBuf.length === 0 ? "{}" : bodyBuf.toString("utf-8");
  const ts = Math.floor(Date.now() / 1000);

  const { authorization } = signTc3({
    secretId, secretKey, action, version, region, body: bodyStr, timestamp: ts,
  });

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    Host: HOST,
    "X-TC-Action": action,
    "X-TC-Version": version,
    "X-TC-Region": region,
    "X-TC-Timestamp": String(ts),
    Authorization: authorization,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`https://${HOST}`, {
      method: "POST",
      headers,
      body: bodyStr,
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { Response: { Error: { Code: "UpstreamFetchFailed", Message: (err as Error).message } } },
      { status: 502 },
    );
  }

  // 把 body 读完再回传，方便服务端打日志
  const upstreamBody = await upstream.text();

  // 调试日志：DescribeTaskDetail 时把整个 Response 顶层 keys 打出来，方便看实际字段
  if (action === "DescribeTaskDetail") {
    try {
      const j = JSON.parse(upstreamBody) as { Response?: Record<string, unknown> };
      const r = j.Response;
      if (r?.Error) {
        console.log(`[MPS DescribeTaskDetail] ERROR`, r.Error);
      } else if (r) {
        // 顶层只 finish 时打全 dump 看结构
        const status = r.Status as string | undefined;
        if (status === "FINISH") {
          console.log("[MPS DescribeTaskDetail] FINISH 完整响应：");
          console.log(JSON.stringify(r, null, 2));
        } else {
          console.log(
            `[MPS DescribeTaskDetail] Status=${status} keys=[${Object.keys(r).join(",")}]`,
          );
        }
      }
    } catch (e) {
      console.log("[MPS DescribeTaskDetail] 响应不是 JSON：", upstreamBody.slice(0, 300), e);
    }
  } else {
    // 其它 action 出错时也打一行
    if (!upstream.ok || /\"Error\"/.test(upstreamBody)) {
      console.log(`[MPS ${action}] HTTP ${upstream.status}:`, upstreamBody.slice(0, 500));
    }
  }

  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (["connection", "transfer-encoding", "content-length", "content-encoding"].includes(lower)) return;
    respHeaders.set(key, value);
  });
  return new NextResponse(upstreamBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const runtime = "nodejs";
