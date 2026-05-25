import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const subjects = new Hono<{ Variables: AuthVariables }>();
subjects.use("*", auth);

function shortId(prefix = "sub_"): string {
  return prefix + randomBytes(8).toString("hex");
}
function now(): string {
  return new Date().toISOString();
}

// GET /api/subjects
subjects.get("/", (c) => {
  const rows = getSqlite()
    .prepare("SELECT * FROM subjects WHERE user_id = ? ORDER BY updated_at DESC")
    .all(c.get("userId")) as Array<Record<string, unknown>>;
  return c.json(rows.map(rowToSubject));
});

// POST /api/subjects
subjects.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  if (name.length < 1 || name.length > 24) {
    return c.json({ code: "INVALID_INPUT", message: "名字需 1-24 个字符" }, 400);
  }

  const db = getSqlite();
  const dup = db.prepare("SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = LOWER(?)").get(userId, name);
  if (dup) return c.json({ code: "DUPLICATE", message: "名字已存在" }, 409);

  const id = shortId("sub_");
  db.prepare(
    "INSERT INTO subjects (id, user_id, name, description, image_url, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, userId, name, body.description || "", body.imageUrl || null, JSON.stringify(body.tags || []), now(), now());

  const row = db.prepare("SELECT * FROM subjects WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToSubject(row), 201);
});

// PATCH /api/subjects/:id
subjects.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();

  const cur = db.prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?").get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "素材不存在" }, 404);

  if (body.name !== undefined) {
    const dup = db.prepare("SELECT id FROM subjects WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?").get(userId, body.name.trim(), id);
    if (dup) return c.json({ code: "DUPLICATE", message: "名字已存在" }, 409);
    db.prepare("UPDATE subjects SET name = ? WHERE id = ?").run(body.name.trim(), id);
  }
  if (body.description !== undefined) db.prepare("UPDATE subjects SET description = ? WHERE id = ?").run(body.description, id);
  if (body.imageUrl !== undefined) db.prepare("UPDATE subjects SET image_url = ? WHERE id = ?").run(body.imageUrl, id);
  if (body.tags !== undefined) db.prepare("UPDATE subjects SET tags = ? WHERE id = ?").run(JSON.stringify(body.tags), id);
  db.prepare("UPDATE subjects SET updated_at = ? WHERE id = ?").run(now(), id);

  const row = db.prepare("SELECT * FROM subjects WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToSubject(row));
});

// DELETE /api/subjects/:id
subjects.delete("/:id", (c) => {
  const userId = c.get("userId");
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?").get(c.req.param("id"), userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "素材不存在" }, 404);
  db.prepare("DELETE FROM subjects WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

function rowToSubject(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    description: row.description as string,
    imageUrl: (row.image_url as string) || undefined,
    tags: JSON.parse((row.tags as string) || "[]"),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export default subjects;
