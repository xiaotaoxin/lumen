import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./middleware/auth";
import authRoutes from "./routes/auth";
import sessionsRoutes from "./routes/sessions";
import generationsRoutes from "./routes/generations";
import canvasesRoutes from "./routes/canvases";
import subjectsRoutes from "./routes/subjects";
import directorStagesRoutes from "./routes/director-stages";
import adminRoutes from "./routes/admin";
import modelsRoutes from "./routes/models";
import mediaRoutes from "./routes/media";
import filesRoutes from "./routes/files";
import proxyRoutes from "./routes/proxy";
import llmRoutes from "./routes/llm";

const app = new Hono();

app.use("*", cors({ origin: "http://localhost:3007", credentials: true }));

// Health check
app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// Auth
app.route("/api/auth", authRoutes);

app.get("/api/auth/me", auth, (c) => {
  return c.json({
    userId: c.get("userId") as string,
    username: c.get("username") as string,
    role: c.get("role") as string,
  });
});

// Core CRUD
app.route("/api/sessions", sessionsRoutes);
app.route("/api/generations", generationsRoutes);
app.route("/api/canvases", canvasesRoutes);
app.route("/api/subjects", subjectsRoutes);
app.route("/api/director-stages", directorStagesRoutes);

// Admin + Models + Media
app.route("/api/admin", adminRoutes);
app.route("/api/admin/models", modelsRoutes);
app.route("/api/media", mediaRoutes);

// File upload & serve
app.route("/api/files", filesRoutes);

// AI Provider proxy + LLM
app.route("/api/proxy", proxyRoutes);
app.route("/api/llm", llmRoutes);

// Data migration from localStorage (open, idempotent)
app.post("/api/migrate", async (c) => {
  const { users: oldUsers, applications: oldApps } = await c.req.json().catch(() => ({}));
  let userCount = 0;
  let appCount = 0;

  if (Array.isArray(oldUsers)) {
    const db = (await import("./db/connection")).getSqlite();
    for (const u of oldUsers) {
      if (!u.username || !u.passwordHash) continue;
      const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(u.username);
      if (exists) continue;
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)"
      ).run(u.id, u.username, u.passwordHash, u.role || "user", u.createdAt || new Date().toISOString());
      userCount++;
    }
  }

  if (Array.isArray(oldApps)) {
    const db = (await import("./db/connection")).getSqlite();
    for (const a of oldApps) {
      if (!a.username || !a.passwordHash) continue;
      const exists = db.prepare("SELECT id FROM registrations WHERE username = ?").get(a.username);
      if (exists) continue;
      db.prepare(
        "INSERT INTO registrations (id, username, password_hash, submitted_at, status) VALUES (?, ?, ?, ?, ?)"
      ).run(a.id, a.username, a.passwordHash, a.submittedAt || new Date().toISOString(), a.status || "pending");
      appCount++;
    }
  }

  return c.json({ users: userCount, applications: appCount });
});

export default app;
