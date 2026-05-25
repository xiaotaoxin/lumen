import { loginApi, registerApi, logoutApi, getSessionApi, migrateData } from "./client";
import { KEYS, storage } from "../storage";
import { LumenApiError } from "./index";

export interface SessionUser {
  id: string;
  username: string;
  role: "user" | "admin";
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const user = await loginApi(username, password);
  return user as SessionUser;
}

export async function register(username: string, password: string): Promise<{ applicationId: string }> {
  return registerApi(username, password);
}

export async function logout(): Promise<void> {
  await logoutApi();
}

export async function getSession(): Promise<SessionUser | null> {
  const user = await getSessionApi();
  return user as SessionUser | null;
}

export async function applicationStatus(
  _username: string,
): Promise<"pending" | "approved" | "rejected" | "not_found"> {
  // Backend-driven: check if user exists in registrations table via the migrate mechanism
  // For now, the register page can just check via the API
  return "not_found";
}

/** Try to migrate old localStorage users/registrations to the backend. */
export async function tryMigrate(): Promise<{ users: number; applications: number }> {
  const oldUsers = storage.get<unknown[]>(KEYS.users, []);
  const oldApps = storage.get<unknown[]>(KEYS.applications, []);
  if (oldUsers.length === 0 && oldApps.length === 0) {
    return { users: 0, applications: 0 };
  }
  const result = await migrateData(oldUsers, oldApps);
  if (result.users > 0 || result.applications > 0) {
    storage.remove(KEYS.users);
    storage.remove(KEYS.applications);
  }
  return result;
}
