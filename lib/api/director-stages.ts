import { api } from "./client";
import { KEYS, storage } from "../storage";
import type { DirectorStageDoc, DirectorCamera, DirectorCharacter } from "../types";
import { shortId } from "../utils";

export async function listMine(_userId: string): Promise<DirectorStageDoc[]> {
  try {
    return await api<DirectorStageDoc[]>("/director-stages");
  } catch {
    return storage.get<DirectorStageDoc[]>(KEYS.directorStages, []);
  }
}

export function getSync(id: string): DirectorStageDoc | null {
  return storage.get<DirectorStageDoc[]>(KEYS.directorStages, []).find(d => d.id === id) ?? null;
}

// Keep the old 2-argument signature
export function saveSync(
  id: string,
  patch: Partial<DirectorStageDoc>,
): void {
  // Write localStorage
  const all = storage.get<DirectorStageDoc[]>(KEYS.directorStages, []);
  const idx = all.findIndex(d => d.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
  storage.set(KEYS.directorStages, all);

  // Fire-and-forget to backend
  void (async () => {
    try {
      await api(`/director-stages/${id}`, { method: "PUT", body: JSON.stringify(patch) });
    } catch { /* noop */ }
  })();
}

// Keep the old object-argument signature
export function createSync(
  input: { userId: string; canvasNodeId?: string; title?: string },
): DirectorStageDoc {
  const now = new Date().toISOString();
  const doc: DirectorStageDoc = {
    id: shortId("ds_"),
    userId: input.userId,
    canvasNodeId: input.canvasNodeId,
    title: input.title || "未命名导演台",
    cameras: [],
    characters: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = storage.get<DirectorStageDoc[]>(KEYS.directorStages, []);
  storage.set(KEYS.directorStages, [doc, ...all]);

  void (async () => {
    try { await api("/director-stages", { method: "POST", body: JSON.stringify(doc) }); } catch { /* noop */ }
  })();
  return doc;
}

export function removeSync(id: string): void {
  storage.set(KEYS.directorStages, storage.get<DirectorStageDoc[]>(KEYS.directorStages, []).filter(d => d.id !== id));
  void (async () => { try { await api(`/director-stages/${id}`, { method: "DELETE" }); } catch { /* noop */ } })();
}
