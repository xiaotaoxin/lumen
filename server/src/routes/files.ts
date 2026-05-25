import { Hono } from "hono";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const UPLOAD_DIR = join(process.cwd(), "storage", "uploads");

const files = new Hono<{ Variables: AuthVariables }>();

// POST /api/files/upload — accept base64 or binary, save to disk, return URL
files.post("/upload", auth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { dataUrl, filename } = body;

  if (!dataUrl) return c.json({ code: "INVALID_INPUT", message: "缺少文件内容" }, 400);

  // dataUrl format: "data:image/png;base64,xxxxx"
  const match = (dataUrl as string).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return c.json({ code: "INVALID_INPUT", message: "请上传 base64 dataURL 格式的文件" }, 400);

  const mimeType = match[1];
  const base64Data = match[2];
  const ext = mimeType.split("/")[1] || "png";
  const name = filename || `${Date.now()}.${ext}`;
  const filePath = join(UPLOAD_DIR, name);

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(filePath, Buffer.from(base64Data, "base64"));
    const url = `/api/files/${name}`;
    return c.json({ url, path: filePath, mimeType });
  } catch (err) {
    return c.json({ code: "UPLOAD_FAILED", message: (err as Error).message }, 500);
  }
});

// GET /api/files/:filename — serve uploaded files
files.get("/:filename", async (c) => {
  const filename = c.req.param("filename");
  // Security: prevent path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return c.json({ code: "INVALID_PATH", message: "非法路径" }, 400);
  }
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) return c.json({ code: "NOT_FOUND", message: "文件不存在" }, 404);

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
    mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";

  const buffer = readFileSync(filePath);
  return new Response(buffer, {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
  });
});

export default files;
