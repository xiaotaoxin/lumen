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

/** Mock async generation — replaces with real adapter call later. */
async function generateCharacterAsset(
  assetId: string,
  subject: Record<string, unknown>,
  kind: string,
): Promise<void> {
  const db = getSqlite();
  const name = subject.name as string;
  const description = (subject.description as string) || name;

  const promptMap: Record<string, string> = {
    full_body: `Full body character design sheet of "${name}". ${description}. Standing pose, front view, full figure from head to toe. Clean background, professional character design style, high quality concept art.`,
    three_views: `Three-view character turnaround sheet of "${name}". ${description}. Front view, side view, back view aligned horizontally. Professional character design reference, clean linework, neutral lighting.`,
    headshot: `Portrait headshot of "${name}". ${description}. Shoulders up, detailed facial features, soft studio lighting, professional quality, expressive eyes.`,
  };

  try {
    // Call the image generation adapter
    const { resolvePlaintextApiKey } = await import("../../../lib/server/models-store");

    // Find a bailian model
    const models = db
      .prepare("SELECT id, provider_model_id FROM models WHERE provider_type LIKE 'bailian%' AND enabled = 1 AND api_key_encrypted IS NOT NULL LIMIT 1")
      .all() as Array<Record<string, unknown>>;
    if (!models.length) throw new Error("No bailian model configured");

    const apiKey = resolvePlaintextApiKey(models[0].id as string);
    if (!apiKey) throw new Error("No API key found");

    const prompt = promptMap[kind] || promptMap.full_body;
    const res = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: (models[0].provider_model_id as string) || "wan2.7-image-pro",
        input: {
          messages: [
            { role: "user", content: [{ text: prompt }] },
          ],
        },
        parameters: { size: "1024*1024", n: 1 },
      }),
    });

    if (!res.ok) throw new Error(`Upstream returned ${res.status}`);

    const data = await res.json() as {
      output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
    };

    const imageUrl = data.output?.choices?.[0]?.message?.content?.find(
      (c: Record<string, unknown>) => typeof c.image === "string",
    )?.image;

    if (imageUrl) {
      db.prepare("UPDATE character_assets SET image_url = ?, status = 'succeeded', prompt_used = ?, updated_at = ? WHERE id = ?")
        .run(imageUrl, prompt, now(), assetId);
    } else {
      throw new Error("No image in response");
    }
  } catch (err) {
    const msg = (err as Error).message;
    db.prepare("UPDATE character_assets SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
      .run(msg, now(), assetId);
  }
}

export default characters;
