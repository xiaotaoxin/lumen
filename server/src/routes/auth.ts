import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { getSqlite } from "../db/connection";
import { signToken } from "../utils/jwt";
import { randomBytes } from "node:crypto";

const auth = new Hono();

function shortId(prefix = ""): string {
  return prefix + randomBytes(8).toString("hex");
}

// POST /api/auth/login
auth.post("/login", async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!username || !password) {
    return c.json({ code: "INVALID_INPUT", message: "请输入账号和密码" }, 400);
  }

  const db = getSqlite();
  const user = db
    .prepare("SELECT id, username, password_hash, role, status FROM users WHERE username = ?")
    .get(username.trim()) as { id: string; username: string; password_hash: string; role: string; status: string } | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ code: "INVALID_CREDENTIALS", message: "账号或密码不正确" }, 401);
  }

  if (user.status === "pending") {
    return c.json({ code: "ACCOUNT_PENDING", message: "你的账号还在审核中，请等待管理员通过" }, 403);
  }
  if (user.status === "rejected" || user.status === "disabled") {
    return c.json({ code: "ACCOUNT_DISABLED", message: "账号已被停用，请联系管理员" }, 403);
  }

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  return c.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// POST /api/auth/register
auth.post("/register", async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  const u = (username || "").trim();
  if (u.length < 1) {
    return c.json({ code: "INVALID_INPUT", message: "请输入账号" }, 400);
  }
  if (!password || password.length < 6) {
    return c.json({ code: "INVALID_INPUT", message: "密码至少 6 个字符" }, 400);
  }

  const db = getSqlite();

  // Check if username already exists in users or pending registrations
  const existingUser = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(u);
  if (existingUser) {
    return c.json({ code: "USERNAME_TAKEN", message: "账号已存在" }, 409);
  }

  const existingReg = db
    .prepare("SELECT id FROM registrations WHERE username = ? AND status = 'pending'")
    .get(u);
  if (existingReg) {
    return c.json({ code: "USERNAME_TAKEN", message: "账号已存在或正在审核中" }, 409);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const id = shortId("app_");
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO registrations (id, username, password_hash, submitted_at, status) VALUES (?, ?, ?, ?, 'pending')",
  ).run(id, u, passwordHash, now);

  return c.json({ applicationId: id }, 201);
});

// POST /api/auth/logout — client discards token, this is a no-op on server
auth.post("/logout", (c) => c.json({ ok: true }));

export default auth;
