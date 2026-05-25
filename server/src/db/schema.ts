import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/* ────────── Users & Auth ────────── */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  status: text("status", { enum: ["pending", "active", "rejected", "disabled"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").notNull(),
  approvedAt: text("approved_at"),
  rejectedReason: text("rejected_reason"),
});

export const registrations = sqliteTable("registrations", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  submittedAt: text("submitted_at").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected"] })
    .notNull()
    .default("pending"),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  rejectedReason: text("rejected_reason"),
});

/* ────────── Sessions (chat conversations) ────────── */

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  title: text("title").notNull().default("新对话"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ────────── Generations ────────── */

export const generations = sqliteTable("generations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => chatSessions.id, { onDelete: "set null" }),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  modelId: text("model_id").notNull(),
  prompt: text("prompt").notNull().default(""),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] })
    .notNull()
    .default("queued"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
  durationMs: integer("duration_ms"),
  cost: integer("cost"),
  errorMessage: text("error_message"),
  favorite: integer("favorite", { mode: "boolean" }).default(false),
  imageUrls: text("image_urls", { mode: "json" }).$type<string[]>(),
  videoUrl: text("video_url"),
  videoPosterUrl: text("video_poster_url"),
  imageParams: text("image_params", { mode: "json" }),
  videoParams: text("video_params", { mode: "json" }),
});

/* ────────── Subjects (@-mentions) ────────── */

export const subjects = sqliteTable("subjects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ────────── Canvases ────────── */

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["flow", "freeform"] }).notNull().default("flow"),
  title: text("title").notNull().default("未命名画布"),
  nodes: text("nodes", { mode: "json" }).notNull(),
  edges: text("edges", { mode: "json" }).notNull(),
  viewport: text("viewport", { mode: "json" }).notNull(),
  coverUrl: text("cover_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ────────── Director Stages (3D) ────────── */

export const directorStages = sqliteTable("director_stages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  canvasNodeId: text("canvas_node_id"),
  title: text("title").notNull().default("未命名导演台"),
  cameras: text("cameras", { mode: "json" }).notNull(),
  characters: text("characters", { mode: "json" }).notNull(),
  props: text("props", { mode: "json" }),
  activeCameraId: text("active_camera_id"),
  aspectRatio: text("aspect_ratio").default("16:9"),
  viewer: text("viewer", { mode: "json" }),
  thumbnailDataUrl: text("thumbnail_data_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ────────── Media Processing ────────── */

export const mediaConfig = sqliteTable("media_config", {
  id: text("id").primaryKey().default("default"),
  secretId: text("secret_id"),
  secretKey: text("secret_key"),
  region: text("region"),
  cosBucket: text("cos_bucket"),
  cosRegion: text("cos_region"),
  enabled: integer("enabled", { mode: "boolean" }).default(false),
  updatedAt: text("updated_at").notNull(),
});

export const mediaTasks = sqliteTable("media_tasks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  inputUrl: text("input_url").notNull(),
  params: text("params", { mode: "json" }).notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] })
    .notNull()
    .default("queued"),
  progress: integer("progress").default(0),
  upstreamTaskId: text("upstream_task_id"),
  outputUrls: text("output_urls", { mode: "json" }).$type<string[]>(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

/* ────────── Existing tables preserved (managed by lib/server/db.ts) ──────────
   models — API keys encrypted storage
   cloned_voices — voice clone metadata
   These are not defined here to avoid migration conflicts.
   They will be assimilated in a later phase.
────────────────────────────────────────────────────────────────────────── */
