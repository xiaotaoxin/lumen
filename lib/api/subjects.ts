import { api } from "./client";
import { KEYS, storage } from "../storage";
import type { Subject } from "../types";
import { shortId } from "../utils";
import { LumenApiError } from "./index";

export interface CreateSubjectInput {
  name: string;
  description: string;
  imageUrl?: string;
  tags?: string[];
}

export async function listMine(_userId: string): Promise<Subject[]> {
  try {
    return await api<Subject[]>("/subjects");
  } catch {
    return storage.get<Subject[]>(KEYS.subjects, []);
  }
}

export async function get(id: string): Promise<Subject | null> {
  try {
    return await api<Subject>(`/subjects/${id}`);
  } catch {
    return storage.get<Subject[]>(KEYS.subjects, []).find(s => s.id === id) ?? null;
  }
}

export async function create(_userId: string, input: CreateSubjectInput): Promise<Subject> {
  const name = input.name.trim();
  if (name.length < 1) throw new LumenApiError("INVALID_CREDENTIALS", "请输入名字");
  if (name.length > 24) throw new LumenApiError("INVALID_CREDENTIALS", "名字不超过 24 个字符");

  try {
    return await api<Subject>("/subjects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (e) {
    // Fallback to localStorage
    if (e instanceof Error && e.message.includes("409")) {
      throw new LumenApiError("USERNAME_TAKEN", "名字已存在");
    }
    const now = new Date().toISOString();
    const s: Subject = { id: shortId("sub_"), userId: _userId, name, description: input.description, imageUrl: input.imageUrl, tags: input.tags || [], createdAt: now, updatedAt: now };
    const all = storage.get<Subject[]>(KEYS.subjects, []);
    storage.set(KEYS.subjects, [s, ...all]);
    return s;
  }
}

export async function update(id: string, patch: Partial<Subject>): Promise<Subject> {
  try {
    return await api<Subject>(`/subjects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  } catch {
    const all = storage.get<Subject[]>(KEYS.subjects, []);
    const idx = all.findIndex(s => s.id === id);
    if (idx < 0) throw new LumenApiError("NOT_FOUND", "素材不存在");
    all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    storage.set(KEYS.subjects, all);
    return all[idx];
  }
}

export async function remove(id: string): Promise<void> {
  try { await api(`/subjects/${id}`, { method: "DELETE" }); } catch { /* noop */ }
  storage.set(KEYS.subjects, storage.get<Subject[]>(KEYS.subjects, []).filter(s => s.id !== id));
}
