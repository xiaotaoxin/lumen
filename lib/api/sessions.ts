import { api } from "./client";
import type { Generation, ModelKind, Session } from "../types";
import { LumenApiError } from "./index";

export interface CreateSessionInput {
  userId?: string; // no longer needed — server derives from JWT
  kind: ModelKind;
  title?: string;
}

export async function listMine(_userId?: string): Promise<Session[]> {
  return api<Session[]>("/sessions");
}

export async function get(id: string): Promise<Session | null> {
  try {
    return await api<Session>(`/sessions/${id}`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

export async function listGenerations(sessionId: string): Promise<Generation[]> {
  return api<Generation[]>(`/generations?sessionId=${sessionId}`);
}

export async function create(input: CreateSessionInput): Promise<Session> {
  return api<Session>("/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** @deprecated Use `await create()` instead. */
export function createSync(input: CreateSessionInput): Promise<Session> {
  return create(input);
}

export async function rename(id: string, title: string): Promise<Session> {
  return api<Session>(`/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function remove(id: string): Promise<void> {
  await api(`/sessions/${id}`, { method: "DELETE" });
}

export async function touch(id: string): Promise<void> {
  try {
    await api(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ updatedAt: new Date().toISOString() }),
    });
  } catch {
    // Fire-and-forget — not critical
  }
}

/** Fire-and-forget async wrapper */
export function touchSync(id: string): void {
  void touch(id);
}

export async function setTitleIfDefault(id: string, title: string): Promise<void> {
  try {
    await api(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  } catch {
    // Fire-and-forget
  }
}

/** Fire-and-forget async wrapper */
export function setTitleIfDefaultSync(id: string, title: string): void {
  void setTitleIfDefault(id, title);
}
