import { getSqlite } from "./connection";
import * as schema from "./schema";

export function runMigrations(): void {
  const sqlite = getSqlite();

  // Create tables from Drizzle schema
  // Using raw SQL to match Drizzle SQLite dialect

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
      created_at      TEXT NOT NULL,
      approved_at     TEXT,
      rejected_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id              TEXT PRIMARY KEY,
      username        TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      submitted_at    TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_at     TEXT,
      reviewed_by     TEXT,
      rejected_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      title       TEXT NOT NULL DEFAULT '新对话',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

    CREATE TABLE IF NOT EXISTS generations (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id       TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      kind             TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      model_id         TEXT NOT NULL,
      prompt           TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
      created_at       TEXT NOT NULL,
      completed_at     TEXT,
      duration_ms      INTEGER,
      cost             INTEGER,
      error_message    TEXT,
      favorite         INTEGER DEFAULT 0,
      image_urls       TEXT,
      video_url        TEXT,
      video_poster_url TEXT,
      image_params     TEXT,
      video_params     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_generations_user    ON generations(user_id);
    CREATE INDEX IF NOT EXISTS idx_generations_session ON generations(session_id);

    CREATE TABLE IF NOT EXISTS subjects (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url   TEXT,
      tags        TEXT DEFAULT '[]',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subjects_user ON subjects(user_id);

    CREATE TABLE IF NOT EXISTS canvases (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'flow' CHECK (kind IN ('flow', 'freeform')),
      title       TEXT NOT NULL DEFAULT '未命名画布',
      nodes       TEXT NOT NULL,
      edges       TEXT NOT NULL,
      viewport    TEXT NOT NULL,
      cover_url   TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_canvases_user ON canvases(user_id);

    CREATE TABLE IF NOT EXISTS director_stages (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canvas_node_id    TEXT,
      title             TEXT NOT NULL DEFAULT '未命名导演台',
      cameras           TEXT NOT NULL,
      characters        TEXT NOT NULL,
      props             TEXT,
      active_camera_id  TEXT,
      aspect_ratio      TEXT DEFAULT '16:9',
      viewer            TEXT,
      thumbnail_data_url TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_director_stages_user ON director_stages(user_id);

    CREATE TABLE IF NOT EXISTS media_config (
      id          TEXT PRIMARY KEY DEFAULT 'default',
      secret_id   TEXT,
      secret_key  TEXT,
      region      TEXT,
      cos_bucket  TEXT,
      cos_region  TEXT,
      enabled     INTEGER DEFAULT 0,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_tasks (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_id          TEXT NOT NULL,
      input_url        TEXT NOT NULL,
      params           TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      progress         INTEGER DEFAULT 0,
      upstream_task_id TEXT,
      output_urls      TEXT,
      error_message    TEXT,
      created_at       TEXT NOT NULL,
      completed_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_tasks_user ON media_tasks(user_id);

    CREATE TABLE IF NOT EXISTS character_assets (
      id              TEXT PRIMARY KEY,
      subject_id      TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL CHECK (kind IN ('full_body', 'three_views', 'headshot')),
      image_url       TEXT,
      prompt_used     TEXT,
      status          TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'succeeded', 'failed')),
      error_message   TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_character_assets_subject ON character_assets(subject_id);

    CREATE TABLE IF NOT EXISTS storyboards (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id    TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      title         TEXT NOT NULL DEFAULT '未命名分镜',
      analysis_data TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_storyboards_user ON storyboards(user_id);

    CREATE TABLE IF NOT EXISTS storyboard_frames (
      id                TEXT PRIMARY KEY,
      storyboard_id     TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
      order_index       INTEGER NOT NULL DEFAULT 0,
      shot_description  TEXT NOT NULL DEFAULT '',
      shot_size         TEXT DEFAULT '中景',
      camera_angle      TEXT DEFAULT '平视',
      camera_movement   TEXT DEFAULT '固定',
      dialogue          TEXT DEFAULT '',
      speaker           TEXT DEFAULT '',
      image_prompt      TEXT DEFAULT '',
      image_url         TEXT,
      video_url         TEXT,
      status            TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'succeeded', 'failed')),
      error_message     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_storyboard_frames_board ON storyboard_frames(storyboard_id);

    CREATE TABLE IF NOT EXISTS series (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT '未命名剧集',
      description TEXT DEFAULT '',
      cover_url   TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_series_user ON series(user_id);

    CREATE TABLE IF NOT EXISTS series_episodes (
      id              TEXT PRIMARY KEY,
      series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
      session_id      TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
      storyboard_id   TEXT REFERENCES storyboards(id) ON DELETE SET NULL,
      order_index     INTEGER NOT NULL DEFAULT 0,
      title           TEXT NOT NULL DEFAULT '未命名集',
      created_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_series_episodes_series ON series_episodes(series_id);
  `);

  // Run Drizzle Kit migrations if any
  console.log("[db] Schema migration complete");
}
