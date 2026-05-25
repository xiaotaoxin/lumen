import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const boards = new Hono<{ Variables: AuthVariables }>();
boards.use("*", auth);

function shortId(prefix = "sb_"): string { return prefix + randomBytes(8).toString("hex"); }
function now(): string { return new Date().toISOString(); }

// GET /api/storyboards
boards.get("/", (c) => {
  const rows = getSqlite()
    .prepare("SELECT * FROM storyboards WHERE user_id = ? ORDER BY updated_at DESC")
    .all(c.get("userId")) as Array<Record<string, unknown>>;
  return c.json(rows.map(r => ({
    id: r.id, userId: r.user_id, sessionId: r.session_id, title: r.title,
    createdAt: r.created_at, updatedAt: r.updated_at,
    frameCount: (getSqlite().prepare("SELECT COUNT(*) as c FROM storyboard_frames WHERE storyboard_id = ?").get(r.id) as { c: number }).c,
  })));
});

// POST /api/storyboards
boards.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const id = shortId("sb_");
  getSqlite().prepare(
    "INSERT INTO storyboards (id, user_id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, userId, body.sessionId || null, body.title || "未命名分镜", now(), now());
  const row = getSqlite().prepare("SELECT * FROM storyboards WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(storyboardRow(row), 201);
});

// GET /api/storyboards/:id (with frames)
boards.get("/:id", (c) => {
  const board = getSqlite().prepare("SELECT * FROM storyboards WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!board) return c.json({ code: "NOT_FOUND", message: "分镜不存在" }, 404);
  const frames = getSqlite()
    .prepare("SELECT * FROM storyboard_frames WHERE storyboard_id = ? ORDER BY order_index")
    .all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json({ ...storyboardRow(board), frames: frames.map(frameRow) });
});

// DELETE /api/storyboards/:id
boards.delete("/:id", (c) => {
  const cur = getSqlite().prepare("SELECT id FROM storyboards WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"));
  if (!cur) return c.json({ code: "NOT_FOUND", message: "分镜不存在" }, 404);
  getSqlite().prepare("DELETE FROM storyboards WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

// POST /api/storyboards/:id/frames
boards.post("/:id/frames", async (c) => {
  const boardId = c.req.param("id");
  const board = getSqlite().prepare("SELECT id FROM storyboards WHERE id = ? AND user_id = ?").get(boardId, c.get("userId"));
  if (!board) return c.json({ code: "NOT_FOUND", message: "分镜不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const maxOrder = (getSqlite().prepare("SELECT MAX(order_index) as m FROM storyboard_frames WHERE storyboard_id = ?").get(boardId) as { m: number | null }).m ?? -1;
  const id = shortId("sf_");
  getSqlite().prepare(
    "INSERT INTO storyboard_frames (id, storyboard_id, order_index, shot_description, shot_size, camera_angle, camera_movement, dialogue, speaker, image_prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)"
  ).run(id, boardId, maxOrder + 1, body.shotDescription || "", body.shotSize || "中景", body.cameraAngle || "平视", body.cameraMovement || "固定", body.dialogue || "", body.speaker || "", body.imagePrompt || "", now(), now());
  const row = getSqlite().prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(frameRow(row), 201);
});

// PATCH /api/storyboards/:id/frames/:frameId
boards.patch("/:id/frames/:frameId", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM storyboard_frames WHERE id = ?").get(c.req.param("frameId"));
  if (!cur) return c.json({ code: "NOT_FOUND", message: "分镜帧不存在" }, 404);
  const fields: Record<string, string> = {
    shotDescription: "shot_description", shotSize: "shot_size", cameraAngle: "camera_angle",
    cameraMovement: "camera_movement", dialogue: "dialogue", speaker: "speaker",
    imagePrompt: "image_prompt", imageUrl: "image_url", status: "status",
  };
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  for (const [key, col] of Object.entries(fields)) {
    if (body[key] !== undefined) { sets.push(`${col} = ?`); vals.push(body[key]); }
  }
  if (body.orderIndex !== undefined) { sets.push("order_index = ?"); vals.push(body.orderIndex); }
  vals.push(c.req.param("frameId"));
  db.prepare(`UPDATE storyboard_frames SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const row = db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(c.req.param("frameId")) as Record<string, unknown>;
  return c.json(frameRow(row));
});

// DELETE /api/storyboards/:id/frames/:frameId
boards.delete("/:id/frames/:frameId", (c) => {
  getSqlite().prepare("DELETE FROM storyboard_frames WHERE id = ?").run(c.req.param("frameId"));
  return c.json({ ok: true });
});

// POST /api/storyboards/:id/frames/reorder
boards.post("/:id/frames/reorder", async (c) => {
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return c.json({ code: "INVALID_INPUT", message: "需要 ids 数组" }, 400);
  const db = getSqlite();
  ids.forEach((id: string, i: number) => {
    db.prepare("UPDATE storyboard_frames SET order_index = ?, updated_at = ? WHERE id = ?").run(i, now(), id);
  });
  return c.json({ ok: true });
});

// POST /api/storyboards/:id/frames/:frameId/generate
boards.post("/:id/frames/:frameId/generate", async (c) => {
  const frameId = c.req.param("frameId");
  const db = getSqlite();
  const frame = db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown> | undefined;
  if (!frame) return c.json({ code: "NOT_FOUND", message: "分镜帧不存在" }, 404);

  db.prepare("UPDATE storyboard_frames SET status = 'running', updated_at = ? WHERE id = ?").run(now(), frameId);

  // Build prompt from frame details
  const parts: string[] = [];
  if (frame.shot_description) parts.push(frame.shot_description as string);
  if (frame.shot_size && frame.shot_size !== "中景") parts.push(`${frame.shot_size} shot`);
  if (frame.camera_angle && frame.camera_angle !== "平视") parts.push(`${frame.camera_angle} angle`);

  // Fire async generation (mock for now, will integrate with real adapter later)
  generateFrameImage(frameId, parts.join(". ")).catch(err => {
    console.error(`[storyboard] generate frame ${frameId} failed:`, err.message);
  });

  const row = db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown>;
  return c.json(frameRow(row));
});

async function generateFrameImage(frameId: string, prompt: string): Promise<void> {
  const db = getSqlite();
  // Mock — simulate delay then return placeholder SVG
  const delay = 1500 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, delay));
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect fill="#1a1a2e" width="1024" height="1024"/><rect fill="#16213e" x="80" y="80" width="864" height="864" rx="16"/><text fill="#e94560" font-family="sans-serif" font-size="28" x="512" y="480" text-anchor="middle">Storyboard Frame</text><text fill="#888" font-family="sans-serif" font-size="16" x="512" y="520" text-anchor="middle">${prompt.slice(0, 50)}</text></svg>`;
    const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    db.prepare("UPDATE storyboard_frames SET image_url = ?, status = 'succeeded', prompt_used = ?, updated_at = ? WHERE id = ?")
      .run(dataUrl, prompt || "", now(), frameId);
  } catch (err) {
    db.prepare("UPDATE storyboard_frames SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
      .run((err as Error).message, now(), frameId);
  }
}

function storyboardRow(r: Record<string, unknown>) {
  return { id: r.id, userId: r.user_id, sessionId: r.session_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at };
}
function frameRow(r: Record<string, unknown>) {
  return {
    id: r.id, storyboardId: r.storyboard_id, orderIndex: r.order_index,
    shotDescription: r.shot_description, shotSize: r.shot_size, cameraAngle: r.camera_angle,
    cameraMovement: r.camera_movement, dialogue: r.dialogue, speaker: r.speaker,
    imagePrompt: r.image_prompt, imageUrl: r.image_url, status: r.status,
    errorMessage: r.error_message, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export default boards;
