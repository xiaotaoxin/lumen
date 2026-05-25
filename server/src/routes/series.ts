import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const series = new Hono<{ Variables: AuthVariables }>();
series.use("*", auth);

function sid(prefix = "ser_"): string { return prefix + randomBytes(8).toString("hex"); }
function now(): string { return new Date().toISOString(); }

// GET /api/series
series.get("/", (c) => {
  const rows = getSqlite()
    .prepare("SELECT s.*, (SELECT COUNT(*) FROM series_episodes WHERE series_id = s.id) as ep_count FROM series s WHERE s.user_id = ? ORDER BY s.updated_at DESC")
    .all(c.get("userId")) as Array<Record<string, unknown>>;
  return c.json(rows.map(r => ({
    id: r.id, userId: r.user_id, title: r.title, description: r.description,
    coverUrl: r.cover_url, episodeCount: r.ep_count,
    createdAt: r.created_at, updatedAt: r.updated_at,
  })));
});

// POST /api/series
series.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = sid("ser_");
  getSqlite().prepare(
    "INSERT INTO series (id, user_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, userId, body.title || "未命名剧集", body.description || "", now(), now());
  const row = getSqlite().prepare("SELECT * FROM series WHERE id = ?").get(id) as Record<string, unknown>;
  const epCount = (getSqlite().prepare("SELECT COUNT(*) as c FROM series_episodes WHERE series_id = ?").get(id) as { c: number }).c;
  return c.json({ ...rowToSeries(row), episodeCount: epCount }, 201);
});

// GET /api/series/:id (with episodes)
series.get("/:id", (c) => {
  const s = getSqlite().prepare("SELECT * FROM series WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!s) return c.json({ code: "NOT_FOUND" }, 404);

  const episodes = getSqlite()
    .prepare("SELECT e.*, cs.title as session_title, sb.title as storyboard_title FROM series_episodes e LEFT JOIN chat_sessions cs ON cs.id = e.session_id LEFT JOIN storyboards sb ON sb.id = e.storyboard_id WHERE e.series_id = ? ORDER BY e.order_index")
    .all(c.req.param("id")) as Array<Record<string, unknown>>;

  return c.json({
    ...rowToSeries(s),
    episodes: episodes.map(e => ({
      id: e.id, seriesId: e.series_id, sessionId: e.session_id, storyboardId: e.storyboard_id,
      orderIndex: e.order_index, title: e.title,
      sessionTitle: e.session_title, storyboardTitle: e.storyboard_title,
      createdAt: e.created_at,
    })),
  });
});

// PATCH /api/series/:id
series.patch("/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM series WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"));
  if (!cur) return c.json({ code: "NOT_FOUND" }, 404);

  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  if (body.title !== undefined) { sets.push("title = ?"); vals.push(body.title); }
  if (body.description !== undefined) { sets.push("description = ?"); vals.push(body.description); }
  if (body.coverUrl !== undefined) { sets.push("cover_url = ?"); vals.push(body.coverUrl); }
  vals.push(c.req.param("id"));
  db.prepare(`UPDATE series SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  const row = db.prepare("SELECT * FROM series WHERE id = ?").get(c.req.param("id")) as Record<string, unknown>;
  return c.json(rowToSeries(row));
});

// DELETE /api/series/:id
series.delete("/:id", (c) => {
  const cur = getSqlite().prepare("SELECT id FROM series WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"));
  if (!cur) return c.json({ code: "NOT_FOUND" }, 404);
  getSqlite().prepare("DELETE FROM series WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// POST /api/series/:id/episodes — add episode
series.post("/:id/episodes", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const s = db.prepare("SELECT id FROM series WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"));
  if (!s) return c.json({ code: "NOT_FOUND" }, 404);

  const maxOrder = (db.prepare("SELECT MAX(order_index) as m FROM series_episodes WHERE series_id = ?").get(c.req.param("id")) as { m: number | null }).m ?? -1;
  const id = sid("ep_");
  db.prepare(
    "INSERT INTO series_episodes (id, series_id, session_id, storyboard_id, order_index, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, c.req.param("id"), body.sessionId || null, body.storyboardId || null, maxOrder + 1, body.title || "未命名集", now());

  const row = db.prepare("SELECT * FROM series_episodes WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(rowToEpisode(row), 201);
});

// DELETE /api/series/:id/episodes/:epId
series.delete("/:id/episodes/:epId", (c) => {
  getSqlite().prepare("DELETE FROM series_episodes WHERE id = ? AND series_id = ?").run(c.req.param("epId"), c.req.param("id"));
  return c.json({ ok: true });
});

// POST /api/series/:id/episodes/reorder
series.post("/:id/episodes/reorder", async (c) => {
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return c.json({ code: "INVALID_INPUT" }, 400);
  const db = getSqlite();
  ids.forEach((id: string, i: number) => {
    db.prepare("UPDATE series_episodes SET order_index = ? WHERE id = ?").run(i, id);
  });
  return c.json({ ok: true });
});

function rowToSeries(r: Record<string, unknown>) {
  return { id: r.id, userId: r.user_id, title: r.title, description: r.description, coverUrl: r.cover_url, createdAt: r.created_at, updatedAt: r.updated_at };
}
function rowToEpisode(r: Record<string, unknown>) {
  return { id: r.id, seriesId: r.series_id, sessionId: r.session_id, storyboardId: r.storyboard_id, orderIndex: r.order_index, title: r.title, createdAt: r.created_at };
}

export default series;
