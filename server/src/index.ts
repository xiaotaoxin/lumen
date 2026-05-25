import { serve } from "@hono/node-server";
import app from "./app";
import { runMigrations } from "./db/migrate";

const port = Number(process.env.PORT) || 3001;

// Run migrations on startup
try {
  runMigrations();
  console.log("[server] Database migrations applied");
} catch (err) {
  console.error("[server] Migration failed:", (err as Error).message);
  process.exit(1);
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Lumen API running on http://localhost:${info.port}`);
  console.log(`[server] Health check: http://localhost:${info.port}/api/health`);
});
