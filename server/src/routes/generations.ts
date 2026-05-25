import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const generations = new Hono<{ Variables: AuthVariables }>();

// All generation routes require auth
generations.use("*", auth);

function shortId(prefix = "g_"): string {
  return prefix + randomBytes(8).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

// GET /api/generations — list for current user
generations.get("/", (c) => {
  const userId = c.get("userId");
  const sessionId = c.req.query("sessionId");
  const kind = c.req.query("kind");

  const db = getSqlite();
  let sql = "SELECT * FROM generations WHERE user_id = ?";
  const params: (string | number)[] = [userId];

  if (sessionId) {
    sql += " AND session_id = ?";
    params.push(sessionId);
  }
  if (kind && (kind === "image" || kind === "video")) {
    sql += " AND kind = ?";
    params.push(kind);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return c.json(rows.map(rowToGeneration));
});

// POST /api/generations — create a new generation record
generations.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = body.id || shortId("g_");

  const db = getSqlite();
  db.prepare(`
    INSERT INTO generations (
      id, user_id, session_id, kind, model_id, prompt, status,
      created_at, completed_at, duration_ms, cost,
      error_message, favorite, image_urls, video_url, video_poster_url,
      image_params, video_params
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    id,
    userId,
    body.sessionId || null,
    body.kind || "image",
    body.modelId || "",
    body.prompt || "",
    body.status || "queued",
    body.createdAt || now(),
    body.completedAt || null,
    body.durationMs || null,
    body.cost || null,
    body.errorMessage || null,
    body.favorite ? 1 : 0,
    body.imageUrls ? JSON.stringify(body.imageUrls) : null,
    body.videoUrl || null,
    body.videoPosterUrl || null,
    body.imageParams ? JSON.stringify(body.imageParams) : null,
    body.videoParams ? JSON.stringify(body.videoParams) : null,
  );

  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToGeneration(row), 201);
});

// GET /api/generations/:id
generations.get("/:id", (c) => {
  const row = getSqlite()
    .prepare("SELECT * FROM generations WHERE id = ?")
    .get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ code: "NOT_FOUND", message: "记录不存在" }, 404);
  return c.json(rowToGeneration(row));
});

// PATCH /api/generations/:id
generations.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();

  const cur = db.prepare("SELECT id FROM generations WHERE id = ?").get(id);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "记录不存在" }, 404);

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (body.status !== undefined) {
    setClauses.push("status = ?");
    params.push(body.status);
    if (body.status === "succeeded" || body.status === "failed") {
      setClauses.push("completed_at = ?");
      params.push(body.completedAt || now());
    }
  }
  if (body.prompt !== undefined) { setClauses.push("prompt = ?"); params.push(body.prompt); }
  if (body.durationMs !== undefined) { setClauses.push("duration_ms = ?"); params.push(body.durationMs); }
  if (body.cost !== undefined) { setClauses.push("cost = ?"); params.push(body.cost); }
  if (body.errorMessage !== undefined) { setClauses.push("error_message = ?"); params.push(body.errorMessage); }
  if (body.favorite !== undefined) { setClauses.push("favorite = ?"); params.push(body.favorite ? 1 : 0); }
  if (body.imageUrls !== undefined) { setClauses.push("image_urls = ?"); params.push(JSON.stringify(body.imageUrls)); }
  if (body.videoUrl !== undefined) { setClauses.push("video_url = ?"); params.push(body.videoUrl); }
  if (body.videoPosterUrl !== undefined) { setClauses.push("video_poster_url = ?"); params.push(body.videoPosterUrl); }
  if (body.imageParams !== undefined) { setClauses.push("image_params = ?"); params.push(JSON.stringify(body.imageParams)); }
  if (body.videoParams !== undefined) { setClauses.push("video_params = ?"); params.push(JSON.stringify(body.videoParams)); }
  if (body.sessionId !== undefined) { setClauses.push("session_id = ?"); params.push(body.sessionId); }

  if (setClauses.length === 0) {
    return c.json(rowToGeneration(cur as Record<string, unknown>));
  }

  params.push(id);
  db.prepare(`UPDATE generations SET ${setClauses.join(", ")} WHERE id = ?`).run(...params);

  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToGeneration(row));
});

// DELETE /api/generations/:id
generations.delete("/:id", (c) => {
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM generations WHERE id = ?").get(c.req.param("id"));
  if (!cur) return c.json({ code: "NOT_FOUND", message: "记录不存在" }, 404);
  db.prepare("DELETE FROM generations WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

function rowToGeneration(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sessionId: (row.session_id as string) || undefined,
    kind: row.kind as string,
    modelId: row.model_id as string,
    prompt: row.prompt as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) || undefined,
    durationMs: (row.duration_ms as number) || undefined,
    cost: (row.cost as number) || undefined,
    errorMessage: (row.error_message as string) || undefined,
    favorite: !!(row.favorite as number),
    imageUrls: row.image_urls ? JSON.parse(row.image_urls as string) : undefined,
    videoUrl: (row.video_url as string) || undefined,
    videoPosterUrl: (row.video_poster_url as string) || undefined,
    imageParams: row.image_params ? JSON.parse(row.image_params as string) : undefined,
    videoParams: row.video_params ? JSON.parse(row.video_params as string) : undefined,
  };
}

export default generations;
