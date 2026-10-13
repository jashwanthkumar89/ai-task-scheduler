import { Hono } from "hono";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tasksRouter } from "./routes/tasks";
import { runsRouter } from "./routes/runs";
import { settingsRouter } from "./routes/settings";
import { usageRouter } from "./routes/usage";
import { startScheduler } from "./scheduler";
import "./db"; // ensure schema is created before anything else runs

const app = new Hono();

app.route("/api/tasks", tasksRouter);
app.route("/api/runs", runsRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/usage", usageRouter);

app.get("/api/health", (c) => c.json({ ok: true }));

// Serve the built React SPA (bun run build:web) so the whole app is one process/port
// for the LaunchAgent to manage. In dev, use `bun run dev:web` (Vite) instead.
const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(here, "..", "..", "web", "dist");
if (existsSync(WEB_DIST)) {
  // Serve real files from dist; every other GET serves index.html so
  // client-side routes (/usage, /personal, /settings) work on refresh.
  app.get("*", async (c) => {
    const path = c.req.path;
    const safe = path.replace(/^\/+/, "").replace(/\.\./g, "");
    if (safe && safe.includes(".")) {
      const file = Bun.file(join(WEB_DIST, safe));
      if (await file.exists()) {
        const type = safe.endsWith(".js")
          ? "text/javascript"
          : safe.endsWith(".css")
            ? "text/css"
            : undefined;
        return new Response(file.stream(), type ? { headers: { "Content-Type": type } } : {});
      }
    }
    const index = Bun.file(join(WEB_DIST, "index.html"));
    return new Response(index.stream(), { headers: { "Content-Type": "text/html" } });
  });
}

const PORT = Number(process.env.PORT ?? 4273);

startScheduler();

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`[server] AI Task Scheduler API listening on http://localhost:${PORT}`);
