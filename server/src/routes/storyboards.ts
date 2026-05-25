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
  const rows = getSqlite().prepare("SELECT * FROM storyboards WHERE user_id = ? ORDER BY updated_at DESC").all(c.get("userId")) as Array<Record<string, unknown>>;
  return c.json(rows.map(r => ({ id: r.id, userId: r.user_id, sessionId: r.session_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, frameCount: (getSqlite().prepare("SELECT COUNT(*) as c FROM storyboard_frames WHERE storyboard_id = ?").get(r.id) as { c: number }).c })));
});

// POST /api/storyboards
boards.post("/", async (c) => {
  const userId = c.get("userId"); const body = await c.req.json().catch(() => ({})); const id = shortId("sb_");
  getSqlite().prepare("INSERT INTO storyboards (id, user_id, session_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, body.sessionId || null, body.title || "未命名分镜", now(), now());
  const row = getSqlite().prepare("SELECT * FROM storyboards WHERE id = ?").get(id) as Record<string, unknown>;
  return c.json(sbRow(row), 201);
});

// GET /api/storyboards/:id (with frames)
boards.get("/:id", (c) => {
  const board = getSqlite().prepare("SELECT * FROM storyboards WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
  if (!board) return c.json({ code: "NOT_FOUND" }, 404);
  const frames = getSqlite().prepare("SELECT * FROM storyboard_frames WHERE storyboard_id = ? ORDER BY order_index").all(c.req.param("id")) as Array<Record<string, unknown>>;
  return c.json({ ...sbRow(board), frames: frames.map(fRow) });
});

// DELETE /api/storyboards/:id
boards.delete("/:id", (c) => {
  if (!getSqlite().prepare("SELECT id FROM storyboards WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"))) return c.json({ code: "NOT_FOUND" }, 404);
  getSqlite().prepare("DELETE FROM storyboards WHERE id = ?").run(c.req.param("id")); return c.json({ ok: true });
});

// POST /api/storyboards/:id/frames
boards.post("/:id/frames", async (c) => {
  if (!getSqlite().prepare("SELECT id FROM storyboards WHERE id = ? AND user_id = ?").get(c.req.param("id"), c.get("userId"))) return c.json({ code: "NOT_FOUND" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const maxOrder = (getSqlite().prepare("SELECT MAX(order_index) as m FROM storyboard_frames WHERE storyboard_id = ?").get(c.req.param("id")) as { m: number | null }).m ?? -1;
  const id = shortId("sf_");
  getSqlite().prepare("INSERT INTO storyboard_frames (id, storyboard_id, order_index, shot_description, shot_size, camera_angle, camera_movement, dialogue, speaker, image_prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)").run(id, c.req.param("id"), maxOrder + 1, body.shotDescription || "", body.shotSize || "中景", body.cameraAngle || "平视", body.cameraMovement || "固定", body.dialogue || "", body.speaker || "", body.imagePrompt || "", now(), now());
  return c.json(fRow(getSqlite().prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(id) as Record<string, unknown>), 201);
});

// PATCH /api/storyboards/:id/frames/:frameId
boards.patch("/:id/frames/:frameId", async (c) => {
  const body = await c.req.json().catch(() => ({})); const db = getSqlite();
  if (!db.prepare("SELECT id FROM storyboard_frames WHERE id = ?").get(c.req.param("frameId"))) return c.json({ code: "NOT_FOUND" }, 404);
  const map: Record<string, string> = { shotDescription: "shot_description", shotSize: "shot_size", cameraAngle: "camera_angle", cameraMovement: "camera_movement", dialogue: "dialogue", speaker: "speaker", imagePrompt: "image_prompt", imageUrl: "image_url", status: "status" };
  const sets: string[] = ["updated_at = ?"]; const vals: unknown[] = [now()];
  for (const [k, col] of Object.entries(map)) { if (body[k] !== undefined) { sets.push(`${col} = ?`); vals.push(body[k]); } }
  if (body.orderIndex !== undefined) { sets.push("order_index = ?"); vals.push(body.orderIndex); }
  vals.push(c.req.param("frameId"));
  db.prepare(`UPDATE storyboard_frames SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return c.json(fRow(db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(c.req.param("frameId")) as Record<string, unknown>));
});

// DELETE /api/storyboards/:id/frames/:frameId
boards.delete("/:id/frames/:frameId", (c) => {
  getSqlite().prepare("DELETE FROM storyboard_frames WHERE id = ?").run(c.req.param("frameId")); return c.json({ ok: true });
});

// POST /api/storyboards/:id/frames/reorder
boards.post("/:id/frames/reorder", async (c) => {
  const { ids } = await c.req.json().catch(() => ({}));
  if (!Array.isArray(ids)) return c.json({ code: "INVALID_INPUT" }, 400);
  const db = getSqlite(); ids.forEach((id: string, i: number) => { db.prepare("UPDATE storyboard_frames SET order_index = ?, updated_at = ? WHERE id = ?").run(i, now(), id); });
  return c.json({ ok: true });
});

// POST .../generate — mock image generation
boards.post("/:id/frames/:frameId/generate", async (c) => {
  const frameId = c.req.param("frameId"); const db = getSqlite();
  const frame = db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown> | undefined;
  if (!frame) return c.json({ code: "NOT_FOUND" }, 404);
  db.prepare("UPDATE storyboard_frames SET status = 'running', updated_at = ? WHERE id = ?").run(now(), frameId);
  const parts = [frame.shot_description, `${frame.shot_size}·${frame.camera_angle}·${frame.camera_movement}`].filter(Boolean).join("，");
  mockGenerate(frameId, parts as string, "image");
  return c.json(fRow(db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown>));
});

// POST .../generate-video — mock video generation (uses frame image as reference)
boards.post("/:id/frames/:frameId/generate-video", async (c) => {
  const frameId = c.req.param("frameId"); const db = getSqlite();
  const frame = db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown> | undefined;
  if (!frame) return c.json({ code: "NOT_FOUND" }, 404);
  if (!frame.image_url) return c.json({ code: "NO_IMAGE", message: "请先生成分镜图" }, 400);
  db.prepare("UPDATE storyboard_frames SET status = 'running', updated_at = ? WHERE id = ?").run(now(), frameId);
  mockGenerate(frameId, frame.image_prompt as string || "", "video");
  return c.json(fRow(db.prepare("SELECT * FROM storyboard_frames WHERE id = ?").get(frameId) as Record<string, unknown>));
});

async function mockGenerate(frameId: string, prompt: string, type: "image" | "video"): Promise<void> {
  const db = getSqlite();
  const delay = 1500 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, delay));
  try {
    if (type === "video") {
      // Generate video mock — an animated SVG placeholder
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="576"><rect fill="#0a0a1a" width="1024" height="576"/><rect fill="#1a1a3e" x="60" y="40" width="904" height="496" rx="12"/><text fill="#e94560" font-family="sans-serif" font-size="24" x="512" y="270" text-anchor="middle">▶ Video Frame</text><text fill="#888" font-size="13" x="512" y="310" text-anchor="middle">${prompt.slice(0, 45)}</text><circle fill="#e94560" cx="512" cy="240" r="28" opacity="0.6"/></svg>`;
      const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
      db.prepare("UPDATE storyboard_frames SET video_url = ?, status = 'succeeded', updated_at = ? WHERE id = ?")
        .run(dataUrl, now(), frameId);
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect fill="#1a1a2e" width="1024" height="1024"/><rect fill="#16213e" x="80" y="80" width="864" height="864" rx="16"/><text fill="#e94560" font-family="sans-serif" font-size="28" x="512" y="480" text-anchor="middle">Storyboard Frame</text><text fill="#888" font-family="sans-serif" font-size="14" x="512" y="520" text-anchor="middle">${prompt.slice(0, 50)}</text></svg>`;
      const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
      db.prepare("UPDATE storyboard_frames SET image_url = ?, status = 'succeeded', image_prompt = ?, updated_at = ? WHERE id = ?")
        .run(dataUrl, prompt || "", now(), frameId);
    }
  } catch (err) {
    db.prepare("UPDATE storyboard_frames SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
      .run((err as Error).message, now(), frameId);
  }
}

function sbRow(r: Record<string, unknown>) { return { id: r.id, userId: r.user_id, sessionId: r.session_id, title: r.title, analysisData: r.analysis_data ? JSON.parse(r.analysis_data as string) : null, createdAt: r.created_at, updatedAt: r.updated_at }; }
function fRow(r: Record<string, unknown>) { return { id: r.id, storyboardId: r.storyboard_id, orderIndex: r.order_index, shotDescription: r.shot_description, shotSize: r.shot_size, cameraAngle: r.camera_angle, cameraMovement: r.camera_movement, dialogue: r.dialogue, speaker: r.speaker, imagePrompt: r.image_prompt, imageUrl: r.image_url, videoUrl: r.video_url, status: r.status, errorMessage: r.error_message, createdAt: r.created_at, updatedAt: r.updated_at }; }

export default boards;
