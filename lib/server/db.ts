/**
 * SQLite 单例连接 + schema 迁移。
 *
 * 文件：<项目根>/lumen.db（已加入 .gitignore）
 *
 * dev mode 下 Next.js 频繁热重启 server module，把连接挂在 globalThis 上避免
 * 重复打开 / 资源泄漏（Next.js 官方推荐的 prisma / drizzle 都是这个模式）。
 */

import path from "node:path";
import Database from "better-sqlite3";

const DB_PATH = path.join(process.cwd(), "lumen.db");

declare global {
  // eslint-disable-next-line no-var
  var __lumenDb: Database.Database | undefined;
}

function open(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL UNIQUE,
      vendor              TEXT NOT NULL,
      kind                TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      description         TEXT,
      provider_type       TEXT NOT NULL,
      endpoint            TEXT,
      api_key_encrypted   TEXT,
      provider_model_id   TEXT,
      cost_per_call       INTEGER NOT NULL DEFAULT 2,
      avg_latency_ms      INTEGER NOT NULL DEFAULT 5000,
      base_failure_rate   REAL NOT NULL DEFAULT 0.05,
      badge               TEXT,
      capabilities        TEXT,             -- JSON 数组
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_models_kind     ON models(kind);
    CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_type);
    CREATE INDEX IF NOT EXISTS idx_models_enabled  ON models(enabled);

    CREATE TABLE IF NOT EXISTS cloned_voices (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      voice_id        TEXT NOT NULL UNIQUE,    -- 阿里云返回的 voice_id（s1_xxx...）
      target_model    TEXT NOT NULL,
      audio_url       TEXT,                    -- 原参考音频公网 URL（仅元数据，可空）
      language_hints  TEXT,                    -- JSON 数组
      created_at      TEXT NOT NULL
    );
  `);
}

export function getDb(): Database.Database {
  if (!globalThis.__lumenDb) {
    globalThis.__lumenDb = open();
  }
  return globalThis.__lumenDb;
}
