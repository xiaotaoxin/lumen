import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { randomBytes } from "node:crypto";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const characters = new Hono<{ Variables: AuthVariables }>();
characters.use("*", auth);

function shortId(prefix = "ca_"): string {
  return prefix + randomBytes(8).toString("hex");
}
function now(): string {
  return new Date().toISOString();
}

// GET /api/characters/:subjectId/assets — list all generated assets for a subject
characters.get("/:subjectId/assets", (c) => {
  const userId = c.get("userId");
  const subjectId = c.req.param("subjectId");

  // Verify subject belongs to user
  const sub = getSqlite()
    .prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?")
    .get(subjectId, userId);
  if (!sub) return c.json({ code: "NOT_FOUND", message: "素材不存在" }, 404);

  const rows = getSqlite()
    .prepare("SELECT * FROM character_assets WHERE subject_id = ? ORDER BY kind, created_at DESC")
    .all(subjectId) as Array<Record<string, unknown>>;

  return c.json(rows.map(rowToAsset));
});

// POST /api/characters/:subjectId/generate — generate character assets for a subject
characters.post("/:subjectId/generate", async (c) => {
  const userId = c.get("userId");
  const subjectId = c.req.param("subjectId");

  const sub = getSqlite()
    .prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?")
    .get(subjectId, userId) as Record<string, unknown> | undefined;
  if (!sub) return c.json({ code: "NOT_FOUND", message: "素材不存在" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const kinds: string[] = body.kinds || ["full_body", "headshot"];
  const db = getSqlite();

  const created: Record<string, unknown>[] = [];
  for (const kind of kinds) {
    if (!["full_body", "three_views", "headshot"].includes(kind)) continue;
    const id = shortId("ca_");
    db.prepare(
      "INSERT INTO character_assets (id, subject_id, user_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
    ).run(id, subjectId, userId, kind, now(), now());

    const row = db.prepare("SELECT * FROM character_assets WHERE id = ?").get(id) as Record<string, unknown>;
    created.push(rowToAsset(row));

    // Kick off async generation (mock for now)
    generateCharacterAsset(id, sub, kind).catch((err) => {
      console.error(`[characters] generate ${id} failed:`, err.message);
    });
  }

  return c.json({ assets: created }, 201);
});

// DELETE /api/characters/:subjectId/assets/:id
characters.delete("/:subjectId/assets/:id", (c) => {
  const userId = c.get("userId");
  const db = getSqlite();
  const id = c.req.param("id");

  const cur = db
    .prepare("SELECT id FROM character_assets WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!cur) return c.json({ code: "NOT_FOUND", message: "资源不存在" }, 404);

  db.prepare("DELETE FROM character_assets WHERE id = ?").run(id);
  return c.json({ ok: true });
});

function rowToAsset(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    subjectId: row.subject_id as string,
    kind: row.kind as string,
    imageUrl: (row.image_url as string) || undefined,
    promptUsed: (row.prompt_used as string) || undefined,
    status: row.status as string,
    errorMessage: (row.error_message as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Mock generation — simulate delay, return placeholder SVG. */
async function generateCharacterAsset(
  assetId: string,
  subject: Record<string, unknown>,
  kind: string,
): Promise<void> {
  const db = getSqlite();
  const name = subject.name as string;
  const labelMap: Record<string, string> = { full_body: "Full Body", three_views: "Three Views", headshot: "Headshot" };

  const delay = 1500 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, delay));
  try {
    const label = labelMap[kind] || "Character";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect fill="#1a1a2e" width="1024" height="1024"/><rect fill="#16213e" x="80" y="80" width="864" height="864" rx="16"/><text fill="#e94560" font-family="sans-serif" font-size="32" x="512" y="460" text-anchor="middle">${label}</text><text fill="#ccc" font-family="sans-serif" font-size="20" x="512" y="500" text-anchor="middle">${name}</text><text fill="#888" font-size="14" x="512" y="530" text-anchor="middle">${kind}</text></svg>`;
    const dataUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    const prompt = `${label} of ${name}`;
    db.prepare("UPDATE character_assets SET image_url = ?, status = 'succeeded', prompt_used = ?, updated_at = ? WHERE id = ?")
      .run(dataUrl, prompt, now(), assetId);
  } catch (err) {
    db.prepare("UPDATE character_assets SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
      .run((err as Error).message, now(), assetId);
  }
}

export default characters;
