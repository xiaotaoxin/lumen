const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001/api";

let token: string | null = null;

// Recover token from localStorage on init
if (typeof window !== "undefined") {
  token = localStorage.getItem("lumen:token");
}

export function setToken(t: string | null) {
  token = t;
  if (t) {
    localStorage.setItem("lumen:token", t);
  } else {
    localStorage.removeItem("lumen:token");
  }
}

export function getToken(): string | null {
  return token;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init?.body && typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> || {}) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.code || "UNKNOWN",
      body.message || `请求失败 (${res.status})`,
      res.status,
    );
  }

  return res.json();
}

/** Log the user in, store token, return user. */
export async function loginApi(
  username: string,
  password: string,
): Promise<{ id: string; username: string; role: string }> {
  const data = await api<{ token: string; user: { id: string; username: string; role: string } }>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ username, password }) },
  );
  setToken(data.token);
  return data.user;
}

/** Register a new account (submits for approval). */
export async function registerApi(
  username: string,
  password: string,
): Promise<{ applicationId: string }> {
  return api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

/** Discard token. */
export async function logoutApi(): Promise<void> {
  setToken(null);
}

/** Get current session from token. */
export async function getSessionApi(): Promise<{ userId: string; username: string; role: string } | null> {
  if (!token) return null;
  try {
    return await api("/auth/me");
  } catch {
    setToken(null);
    return null;
  }
}

/** Migrate localStorage data to the backend. */
export async function migrateData(
  users: unknown[],
  applications: unknown[],
): Promise<{ users: number; applications: number }> {
  return api("/migrate", {
    method: "POST",
    body: JSON.stringify({ users, applications }),
  });
}
