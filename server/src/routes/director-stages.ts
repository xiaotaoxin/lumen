import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const stages = new Hono<{ Variables: AuthVariables }>();
stages.use("*", auth);

function shortId(prefix = "ds_"): string {
  return prefix + randomBytes(8).toString("hex");
}
function now(): string {
  return new Date().toISOString();
}

// GET /api/director-stages
stages.get("/", (c) => {
  const rows = getSqlite()
    .prepare("SELECT * FROM director_stages WHERE user_id = ? ORDER BY updated_at DESC")
    .all(c.get("userId")) as Array<Record<string, unknown>>;
  return c.json(rows.map(rowToStage));
});

// POST /api/director-stages
stages.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = body.id || shortId("ds_");
  const db = getSqlite();
  db.prepare(`
    INSERT INTO director_stages (id, user_id, canvas_node_id, title, cameras, characters, props, active_camera_id, aspect_ratio, viewer, thumbnail_data_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId,
    body.canvasNodeId || null,
    body.title || "未命名导演台",
    JSON.stringify(body.cameras || []),
    JSON.stringify(body.characters || []),
    body.props ? JSON.stringify(body.props) : null,
    body.activeCameraId || null,
    body.aspectRatio || "16:9",
    body.viewer ? JSON.stringify(body.viewer) : null,
    body.thumbnailDataUrl || null,
    body.createdAt || now(),
    body.updatedAt || now(),
  );
  const row = db.prepare("SELECT * FROM director_stages WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToStage(row), 201);
});

// PUT /api/director-stages/:id
stages.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();

  const cur = db.prepare("SELECT id FROM director_stages WHERE id = ? AND user_id = ?").get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "导演台不存在" }, 404);

  db.prepare(`
    UPDATE director_stages SET
      title = ?, cameras = ?, characters = ?, props = ?, active_camera_id = ?,
      aspect_ratio = ?, viewer = ?, thumbnail_data_url = ?, updated_at = ?
    WHERE id = ?
  `).run(
    body.title || "未命名导演台",
    JSON.stringify(body.cameras || []),
    JSON.stringify(body.characters || []),
    body.props ? JSON.stringify(body.props) : null,
    body.activeCameraId || null,
    body.aspectRatio || "16:9",
    body.viewer ? JSON.stringify(body.viewer) : null,
    body.thumbnailDataUrl || null,
    now(),
    id,
  );
  const row = db.prepare("SELECT * FROM director_stages WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToStage(row));
});

// DELETE /api/director-stages/:id
stages.delete("/:id", (c) => {
  const userId = c.get("userId");
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM director_stages WHERE id = ? AND user_id = ?").get(c.req.param("id"), userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "导演台不存在" }, 404);
  db.prepare("DELETE FROM director_stages WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

function rowToStage(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    canvasNodeId: (row.canvas_node_id as string) || undefined,
    title: row.title as string,
    cameras: JSON.parse(row.cameras as string),
    characters: JSON.parse(row.characters as string),
    props: row.props ? JSON.parse(row.props as string) : undefined,
    activeCameraId: (row.active_camera_id as string) || undefined,
    aspectRatio: (row.aspect_ratio as string) || "16:9",
    viewer: row.viewer ? JSON.parse(row.viewer as string) : undefined,
    thumbnailDataUrl: (row.thumbnail_data_url as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export default stages;
