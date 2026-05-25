import { Hono } from "hono";
import * as crypto from "node:crypto";
import { getSqlite } from "../db/connection";
import { encryptApiKey, decryptApiKey } from "../../../lib/server/crypto";
import { auth, adminOnly } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";
import type { ModelKind, ProviderType, ImageCapability } from "../../../lib/types";

const models = new Hono<{ Variables: AuthVariables }>();
models.use("*", auth, adminOnly);

function shortId(prefix = "m_"): string {
  return prefix + crypto.randomBytes(6).toString("hex");
}

interface ModelRow {
  id: string; name: string; vendor: string; kind: ModelKind;
  description: string | null; provider_type: ProviderType; endpoint: string | null;
  api_key_encrypted: string | null; provider_model_id: string | null;
  cost_per_call: number; avg_latency_ms: number; base_failure_rate: number;
  badge: string | null; capabilities: string | null; enabled: number;
  created_at: string; updated_at: string;
}

function rowToDto(r: ModelRow) {
  return {
    id: r.id, name: r.name, vendor: r.vendor, kind: r.kind,
    description: r.description ?? "（无描述）",
    providerType: r.provider_type, endpoint: r.endpoint ?? undefined,
    providerModelId: r.provider_model_id ?? undefined,
    costPerCall: r.cost_per_call, avgLatencyMs: r.avg_latency_ms,
    baseFailureRate: r.base_failure_rate,
    badge: r.badge ? (r.badge as "new" | "fast" | "premium") : undefined,
    capabilities: r.capabilities ? JSON.parse(r.capabilities) : undefined,
    enabled: !!r.enabled, hasApiKey: !!r.api_key_encrypted,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// GET /api/admin/models
models.get("/", (c) => {
  const rows = getSqlite()
    .prepare("SELECT * FROM models ORDER BY created_at DESC")
    .all() as ModelRow[];
  return c.json({ models: rows.map(rowToDto) });
});

// POST /api/admin/models
models.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  const vendor = (body.vendor || "").trim();
  if (!name || !vendor) return c.json({ error: "名称和厂商不能为空" }, 400);
  if (body.kind !== "image" && body.kind !== "video") return c.json({ error: "kind 必须是 image 或 video" }, 400);

  const db = getSqlite();
  const exists = db.prepare("SELECT id FROM models WHERE LOWER(name) = LOWER(?)").get(name);
  if (exists) return c.json({ error: "已经有同名模型" }, 400);

  const now = new Date().toISOString();
  const id = shortId("custom-");
  const apiKeyEncrypted = body.apiKey ? encryptApiKey(body.apiKey) : null;

  db.prepare(`
    INSERT INTO models (id, name, vendor, kind, description, provider_type, endpoint, api_key_encrypted, provider_model_id, cost_per_call, avg_latency_ms, base_failure_rate, badge, capabilities, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, vendor, body.kind, body.description?.trim() || null, body.providerType || "mock", body.endpoint?.trim() || null, apiKeyEncrypted, body.providerModelId?.trim() || null, body.costPerCall ?? 2, body.avgLatencyMs ?? 5000, body.baseFailureRate ?? 0.05, body.badge ?? null, body.kind === "image" && body.capabilities ? JSON.stringify(body.capabilities) : null, body.enabled === false ? 0 : 1, now, now);

  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow;
  return c.json({ model: rowToDto(row) }, 201);
});

// PATCH /api/admin/models/:id
models.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const cur = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow | undefined;
  if (!cur) return c.json({ error: "模型不存在" }, 404);

  if (body.name) {
    const dup = db.prepare("SELECT id FROM models WHERE LOWER(name) = LOWER(?) AND id != ?").get(body.name.trim(), id);
    if (dup) return c.json({ error: "已经有同名模型" }, 400);
  }

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now];

  const f = (col: string, val: unknown) => { if (val !== undefined) { sets.push(`${col} = ?`); vals.push(val); } };
  f("name", body.name?.trim()); f("vendor", body.vendor?.trim());
  f("kind", body.kind); f("description", body.description?.trim() || null);
  f("provider_type", body.providerType); f("endpoint", body.endpoint?.trim() || null);
  f("provider_model_id", body.providerModelId?.trim() || null);
  f("cost_per_call", body.costPerCall); f("avg_latency_ms", body.avgLatencyMs);
  f("base_failure_rate", body.baseFailureRate); f("badge", body.badge ?? null);
  f("enabled", body.enabled !== undefined ? (body.enabled ? 1 : 0) : undefined);

  if (body.capabilities !== undefined) {
    if (cur.kind === "image" && body.capabilities) {
      sets.push("capabilities = ?"); vals.push(JSON.stringify(body.capabilities));
    } else {
      sets.push("capabilities = NULL"); vals.push(null);
    }
  }

  if (body.apiKey !== undefined) {
    if (body.apiKey === "") { sets.push("api_key_encrypted = NULL"); }
    else { sets.push("api_key_encrypted = ?"); vals.push(encryptApiKey(body.apiKey)); }
  }

  vals.push(id);
  db.prepare(`UPDATE models SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  const row = db.prepare("SELECT * FROM models WHERE id = ?").get(id) as ModelRow;
  return c.json({ model: rowToDto(row) });
});

// DELETE /api/admin/models/:id
models.delete("/:id", (c) => {
  const cur = getSqlite().prepare("SELECT id FROM models WHERE id = ?").get(c.req.param("id"));
  if (!cur) return c.json({ error: "模型不存在" }, 404);
  getSqlite().prepare("DELETE FROM models WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

export default models;
