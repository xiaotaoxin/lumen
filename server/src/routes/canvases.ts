import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const canvases = new Hono<{ Variables: AuthVariables }>();
canvases.use("*", auth);

function shortId(prefix = "c_"): string {
  return prefix + randomBytes(8).toString("hex");
}
function now(): string {
  return new Date().toISOString();
}

// GET /api/canvases
canvases.get("/", (c) => {
  const userId = c.get("userId");
  const rows = getSqlite()
    .prepare("SELECT * FROM canvases WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as Array<Record<string, unknown>>;
  return c.json(rows.map(rowToCanvas));
});

// POST /api/canvases
canvases.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = body.id || shortId("c_");
  const db = getSqlite();
  db.prepare(`
    INSERT INTO canvases (id, user_id, kind, title, nodes, edges, viewport, cover_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId,
    body.kind || "flow",
    body.title || "未命名画布",
    JSON.stringify(body.nodes || []),
    JSON.stringify(body.edges || []),
    JSON.stringify(body.viewport || { x: 0, y: 0, zoom: 1 }),
    body.coverUrl || null,
    body.createdAt || now(),
    body.updatedAt || now(),
  );
  const row = db.prepare("SELECT * FROM canvases WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToCanvas(row), 201);
});

// GET /api/canvases/:id
canvases.get("/:id", (c) => {
  const row = getSqlite()
    .prepare("SELECT * FROM canvases WHERE id = ?")
    .get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!row) return c.json({ code: "NOT_FOUND", message: "画布不存在" }, 404);
  return c.json(rowToCanvas(row));
});

// PUT /api/canvases/:id — full save (nodes + edges + viewport)
canvases.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();

  const cur = db.prepare("SELECT id FROM canvases WHERE id = ? AND user_id = ?").get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "画布不存在" }, 404);

  db.prepare(`
    UPDATE canvases SET
      title = ?, nodes = ?, edges = ?, viewport = ?, cover_url = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.title || "未命名画布",
    body.nodes ? JSON.stringify(body.nodes) : "[]",
    body.edges ? JSON.stringify(body.edges) : "[]",
    body.viewport ? JSON.stringify(body.viewport) : '{"x":0,"y":0,"zoom":1}',
    body.coverUrl || null,
    now(),
    id,
  );
  const row = db.prepare("SELECT * FROM canvases WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToCanvas(row));
});

// DELETE /api/canvases/:id
canvases.delete("/:id", (c) => {
  const userId = c.get("userId");
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM canvases WHERE id = ? AND user_id = ?").get(c.req.param("id"), userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "画布不存在" }, 404);
  db.prepare("DELETE FROM canvases WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

function rowToCanvas(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    kind: (row.kind as string) || "flow",
    title: row.title as string,
    nodes: JSON.parse(row.nodes as string),
    edges: JSON.parse(row.edges as string),
    viewport: JSON.parse(row.viewport as string),
    coverUrl: row.cover_url as string || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export default canvases;
