import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { auth } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const media = new Hono<{ Variables: AuthVariables }>();
media.use("*", auth);

// GET /api/media/config
media.get("/config", (c) => {
  const row = getSqlite()
    .prepare("SELECT * FROM media_config WHERE id = 'default'")
    .get() as Record<string, unknown> | undefined;
  if (!row) return c.json({ secretId: "", secretKey: "", region: "ap-shanghai", cosBucket: "", cosRegion: "", enabled: false, updatedAt: "" });
  return c.json({
    secretId: row.secret_id || "", secretKey: row.secret_key || "",
    region: row.region || "ap-shanghai", cosBucket: row.cos_bucket || "",
    cosRegion: row.cos_region || "", enabled: !!(row.enabled),
    updatedAt: row.updated_at,
  });
});

// POST /api/media/config
media.post("/config", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO media_config (id, secret_id, secret_key, region, cos_bucket, cos_region, enabled, updated_at)
    VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      secret_id = excluded.secret_id, secret_key = excluded.secret_key,
      region = excluded.region, cos_bucket = excluded.cos_bucket,
      cos_region = excluded.cos_region, enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(
    (body.secretId || "").trim(), (body.secretKey || "").trim(),
    (body.region || "ap-shanghai").trim(), (body.cosBucket || "").trim(),
    (body.cosRegion || "").trim(), body.enabled ? 1 : 0, now,
  );

  return c.json({ ok: true, updatedAt: now });
});

export default media;
