import { Hono } from "hono";
import { getSqlite } from "../db/connection";
import { auth, adminOnly } from "../middleware/auth";
import type { AuthVariables } from "../middleware/auth";

const admin = new Hono<{ Variables: AuthVariables }>();
admin.use("*", auth, adminOnly);

// ─── Users ───

admin.get("/users", (c) => {
  const rows = getSqlite()
    .prepare("SELECT id, username, role, status, created_at, approved_at FROM users ORDER BY created_at DESC")
    .all() as Array<Record<string, unknown>>;
  return c.json(rows.map(u => ({
    id: u.id, username: u.username, role: u.role, status: u.status,
    createdAt: u.created_at, approvedAt: u.approved_at,
  })));
});

admin.patch("/users/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const cur = db.prepare("SELECT id FROM users WHERE id = ?").get(c.req.param("id"));
  if (!cur) return c.json({ code: "NOT_FOUND", message: "用户不存在" }, 404);

  if (body.status) db.prepare("UPDATE users SET status = ? WHERE id = ?").run(body.status, c.req.param("id"));
  if (body.role) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, c.req.param("id"));
  return c.json({ ok: true });
});

// ─── Applications (registrations) ───

admin.get("/applications", (c) => {
  const rows = getSqlite()
    .prepare("SELECT * FROM registrations ORDER BY submitted_at DESC")
    .all() as Array<Record<string, unknown>>;
  return c.json(rows.map(a => ({
    id: a.id, username: a.username, status: a.status,
    submittedAt: a.submitted_at, reviewedAt: a.reviewed_at,
    reviewedBy: a.reviewed_by, rejectedReason: a.rejected_reason,
  })));
});

admin.post("/applications/:id/approve", async (c) => {
  const reviewer = c.get("username") as string;
  const id = c.req.param("id");
  const db = getSqlite();
  const app = db.prepare("SELECT * FROM registrations WHERE id = ? AND status = 'pending'").get(id) as Record<string, unknown> | undefined;
  if (!app) return c.json({ code: "NOT_FOUND", message: "申请不存在或已处理" }, 404);

  const now = new Date().toISOString();
  const newUserId = "u_" + Math.random().toString(36).slice(2, 10);

  db.prepare("UPDATE registrations SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ?").run(now, reviewer, id);
  db.prepare("INSERT INTO users (id, username, password_hash, role, status, created_at, approved_at) VALUES (?, ?, ?, 'user', 'active', ?, ?)").run(newUserId, app.username, app.password_hash, app.submitted_at, now);

  const user = db.prepare("SELECT id, username, role, status FROM users WHERE id = ?").get(newUserId);
  return c.json({ user });
});

admin.post("/applications/:id/reject", async (c) => {
  const reviewer = c.get("username") as string;
  const { reason } = await c.req.json().catch(() => ({}));
  const db = getSqlite();
  const app = db.prepare("SELECT id FROM registrations WHERE id = ? AND status = 'pending'").get(c.req.param("id"));
  if (!app) return c.json({ code: "NOT_FOUND", message: "申请不存在或已处理" }, 404);
  db.prepare("UPDATE registrations SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, rejected_reason = ? WHERE id = ?").run(new Date().toISOString(), reviewer, reason || "", c.req.param("id"));
  return c.json({ ok: true });
});

// ─── Metrics ───

admin.get("/metrics", (c) => {
  const db = getSqlite();
  const genCount = (db.prepare("SELECT COUNT(*) as c FROM generations").get() as { c: number }).c;
  const userCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'active'").get() as { c: number }).c;
  const pendingCount = (db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'pending'").get() as { c: number }).c;
  const failCount = (db.prepare("SELECT COUNT(*) as c FROM generations WHERE status = 'failed'").get() as { c: number }).c;
  const avgLatency = (db.prepare("SELECT AVG(duration_ms) as v FROM generations WHERE duration_ms IS NOT NULL").get() as { v: number | null }).v ?? 0;

  const now = Date.now();
  const today = (db.prepare("SELECT COUNT(*) as c FROM generations WHERE created_at > ?").get(new Date(now - 86400000).toISOString()) as { c: number }).c;
  const week = (db.prepare("SELECT COUNT(*) as c FROM generations WHERE created_at > ?").get(new Date(now - 604800000).toISOString()) as { c: number }).c;

  return c.json({
    totals: {
      callsToday: today,
      callsThisWeek: week,
      callsThisMonth: genCount, // simplified
      creditsConsumedTotal: genCount * 2, // simplified
      activeUsers: userCount,
      pendingApprovals: pendingCount,
      failureRate: genCount > 0 ? failCount / genCount : 0,
      avgLatencyMs: Math.round(avgLatency),
    },
    perUser: [],
    modelShare: [],
    trend: { daily: [], weekly: [], monthly: [] },
    failures: { rate: genCount > 0 ? failCount / genCount : 0, series: [] },
    latency: { avgMs: Math.round(avgLatency), p95Ms: 0, series: [] },
  });
});

export default admin;
