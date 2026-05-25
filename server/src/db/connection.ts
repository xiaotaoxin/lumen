import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DB_PATH = path.join(process.cwd(), "lumen.db");

function openDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __lumenServerDb: Database.Database | undefined;
}

function getSqlite(): Database.Database {
  if (!globalThis.__lumenServerDb) {
    globalThis.__lumenServerDb = openDb();
  }
  return globalThis.__lumenServerDb;
}

export const db = drizzle(getSqlite(), { schema });
export { getSqlite };
