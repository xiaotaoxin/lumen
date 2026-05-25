import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const sessions = new Hono<{ Variables: AuthVariables }>();

// All session routes require auth
sessions.use("*", auth);

function shortId(prefix = "s_"): string {
  return prefix + randomBytes(8).toString("hex");
}

function now(): string {
  return new Date().toISOString();
}

// GET /api/sessions — list sessions for current user
sessions.get("/", (c) => {
  const userId = c.get("userId");
  const kind = c.req.query("kind");

  const db = getSqlite();
  let rows;
  if (kind && (kind === "image" || kind === "video")) {
    rows = db
      .prepare("SELECT * FROM chat_sessions WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC")
      .all(userId, kind);
  } else {
    rows = db
      .prepare("SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId);
  }

  const list = (rows as Array<Record<string, unknown>>).map(rowToSession);
  return c.json(list);
});

// POST /api/sessions — create a new session
sessions.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = shortId("s_");

  const db = getSqlite();
  db.prepare(
    "INSERT INTO chat_sessions (id, user_id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, userId, body.kind || "image", body.title || "新对话", now(), now());

  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToSession(row), 201);
});

// GET /api/sessions/:id
sessions.get("/:id", (c) => {
  const userId = c.get("userId");
  const row = getSqlite()
    .prepare("SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?")
    .get(c.req.param("id"), userId) as Record<string, unknown> | undefined;
  if (!row) return c.json({ code: "NOT_FOUND", message: "会话不存在" }, 404);
  return c.json(rowToSession(row));
});

// PATCH /api/sessions/:id
sessions.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const db = getSqlite();
  const cur = db
    .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "会话不存在" }, 404);

  if (body.title !== undefined) {
    db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(body.title, now(), id);
  }
  if (body.updatedAt !== undefined) {
    db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?")
      .run(body.updatedAt, id);
  }
  if (body.kind !== undefined) {
    db.prepare("UPDATE chat_sessions SET kind = ?, updated_at = ? WHERE id = ?")
      .run(body.kind, now(), id);
  }

  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToSession(row));
});

// DELETE /api/sessions/:id — cascade delete generations
sessions.delete("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getSqlite();

  const cur = db
    .prepare("SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "会话不存在" }, 404);

  db.prepare("DELETE FROM generations WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  return c.json({ ok: true });
});

function rowToSession(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: row.kind as string,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export default sessions;
