import { Hono } from "hono";
import { db } from "../db";
import type { Run } from "../types";
import { readRunLog } from "../lib/runLog";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCREENSHOTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "screenshots"
);

export const runsRouter = new Hono();

// Live log for a run: the runner streams stdout/stderr here while the
// process is still going, so the UI can show output before it finishes.
runsRouter.get("/:id/log", (c) => {
  const id = c.req.param("id");
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
  if (!run) return c.json({ error: "Not found" }, 404);
  return c.json({ log: readRunLog(id) ?? run.output ?? "" });
});

// Serve the failure screenshot for a run. Only files inside the
// screenshots directory are served - the stored path is re-resolved
// against that dir so a bad/missing record can't escape it.
runsRouter.get("/:id/screenshot", (c) => {
  const id = c.req.param("id");
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
  if (!run?.screenshot_path) return c.json({ error: "No screenshot" }, 404);

  const resolved = resolve(run.screenshot_path);
  if (!resolved.startsWith(resolve(SCREENSHOTS_DIR) + sep) || !existsSync(resolved)) {
    return c.json({ error: "Screenshot file missing" }, 404);
  }
  return c.body(Bun.file(resolved).stream(), 200, { "Content-Type": "image/png" });
});

runsRouter.get("/", (c) => {
  const taskId = c.req.query("taskId");
  const limit = Number(c.req.query("limit") ?? "100");
  const rows = taskId
    ? (db
        .query("SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?")
        .all(taskId, limit) as Run[])
    : (db.query("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit) as Run[]);
  return c.json(rows);
});

// Mark a pending reminder-task occurrence as done.
runsRouter.post("/:id/complete", (c) => {
  const id = c.req.param("id");
  const run = db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run | undefined;
  if (!run) return c.json({ error: "Not found" }, 404);

  db.query("UPDATE runs SET status = 'success', finished_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
  const updated = db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run;
  return c.json(updated);
});
