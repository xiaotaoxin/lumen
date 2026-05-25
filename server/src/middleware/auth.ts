import { createMiddleware } from "hono/factory";

export interface AuthVariables {
  userId: string;
  username: string;
  role: string;
}

export const auth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ code: "UNAUTHORIZED", message: "请先登录" }, 401);
  }
  try {
    const { verifyToken } = await import("../utils/jwt");
    const payload = verifyToken(header.slice(7));
    c.set("userId", payload.userId);
    c.set("username", payload.username);
    c.set("role", payload.role);
    await next();
  } catch {
    return c.json({ code: "TOKEN_EXPIRED", message: "登录已过期，请重新登录" }, 401);
  }
});

export const adminOnly = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const role = c.get("role");
  if (role !== "admin") {
    return c.json({ code: "FORBIDDEN", message: "需要管理员权限" }, 403);
  }
  await next();
});
