// Tiny localStorage-backed JSON store. Replaceable with IndexedDB or
// a real backend without changing call sites.

function isClient() {
  return typeof window !== "undefined";
}

/**
 * Listeners notified when a storage write fails (typically quota exceeded).
 * UI components (e.g. a toast) subscribe to surface the failure to the user.
 */
type StorageErrorListener = (info: { key: string; error: unknown; bytes: number }) => void;
const errorListeners = new Set<StorageErrorListener>();

export function onStorageError(fn: StorageErrorListener): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    if (!isClient()) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },
  /**
   * Returns true on success, false on failure. Failures are also broadcast
   * via onStorageError so a UI layer can surface them.
   */
  set<T>(key: string, value: T): boolean {
    if (!isClient()) return false;
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      console.error("[storage] serialize failed for", key, error);
      errorListeners.forEach((fn) => fn({ key, error, bytes: 0 }));
      return false;
    }
    try {
      window.localStorage.setItem(key, serialized);
      return true;
    } catch (error) {
      console.error(
        `[storage] write failed for "${key}" (${(serialized.length / 1024).toFixed(1)} KB) — likely quota exceeded`,
        error,
      );
      errorListeners.forEach((fn) => fn({ key, error, bytes: serialized.length }));
      return false;
    }
  },
  remove(key: string) {
    if (!isClient()) return;
    window.localStorage.removeItem(key);
  },
};

export const KEYS = {
  users: "lumen:users",
  applications: "lumen:applications",
  generations: "lumen:generations",
  subjects: "lumen:subjects",
  sessions: "lumen:sessions",
  canvases: "lumen:canvases",
  customModels: "lumen:customModels",
  directorStages: "lumen:directorStages",
  mediaProcessingConfig: "lumen:mediaProcessingConfig",
  mediaProcessingTasks: "lumen:mediaProcessingTasks",
  session: "lumen:session",
  seeded: "lumen:seeded:v3",
};
