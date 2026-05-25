import { getSqlite } from "../db/connection";

/** Migrate localStorage users/registrations to server DB on first run. */
export function migrateFromLocalStorage(): { users: number; registrations: number } {
  const db = getSqlite();

  // Check if users table already has data
  const count = (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
  if (count > 0) return { users: 0, registrations: 0 };

  // Read from localStorage... but we're on the server! Can't access browser localStorage.
  // This migration will be handled on the client side: the frontend will POST existing
  // localStorage data to the backend on first login after upgrade.
  return { users: 0, registrations: 0 };
}
