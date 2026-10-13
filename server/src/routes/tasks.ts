import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { Task } from "../types";
import { describeSchedule } from "../lib/time";
import { runTaskNow, isTaskRunning } from "../scheduler";

export const tasksRouter = new Hono();

function serializeTask(task: Task) {
  return {
    ...task,
    enabled: !!task.enabled,
    script_args: task.script_args ? JSON.parse(task.script_args) : [],
    schedule_days_of_week: task.schedule_days_of_week ? JSON.parse(task.schedule_days_of_week) : [],
    schedule_description: describeSchedule(task),
    running: isTaskRunning(task.id),
  };
}

tasksRouter.get("/", (c) => {
  const category = c.req.query("category");
  const rows = category
    ? (db.query("SELECT * FROM tasks WHERE category = ? ORDER BY created_at DESC").all(category) as Task[])
    : (db.query("SELECT * FROM tasks ORDER BY created_at DESC").all() as Task[]);
  return c.json(rows.map(serializeTask));
});

tasksRouter.get("/:id", (c) => {
  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(c.req.param("id")) as Task | undefined;
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(serializeTask(row));
});

tasksRouter.post("/", async (c) => {
  const body = await c.req.json();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.query(
    `INSERT INTO tasks (
      id, name, category, kind, enabled,
      prompt, model,
      script_path, script_args, secrets_file,
      schedule_type, schedule_time, schedule_days_of_week, schedule_day_of_month,
      timeout_minutes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    body.name,
    body.category,
    body.kind,
    body.enabled === false ? 0 : 1,
    body.prompt ?? null,
    body.model ?? null,
    body.script_path ?? null,
    body.script_args ? JSON.stringify(body.script_args) : null,
    body.secrets_file ?? null,
    body.schedule_type,
    body.schedule_time,
    body.schedule_days_of_week ? JSON.stringify(body.schedule_days_of_week) : null,
    body.schedule_day_of_month ?? null,
    body.timeout_minutes ?? 15,
    now,
    now
  );

  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
  return c.json(serializeTask(row), 201);
});

tasksRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const merged: Record<string, unknown> = {
    name: body.name ?? existing.name,
    category: body.category ?? existing.category,
    kind: body.kind ?? existing.kind,
    enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    prompt: body.prompt !== undefined ? body.prompt : existing.prompt,
    model: body.model !== undefined ? body.model : existing.model,
    script_path: body.script_path !== undefined ? body.script_path : existing.script_path,
    script_args:
      body.script_args !== undefined ? JSON.stringify(body.script_args) : existing.script_args,
    secrets_file: body.secrets_file !== undefined ? body.secrets_file : existing.secrets_file,
    schedule_type: body.schedule_type ?? existing.schedule_type,
    schedule_time: body.schedule_time ?? existing.schedule_time,
    schedule_days_of_week:
      body.schedule_days_of_week !== undefined
        ? JSON.stringify(body.schedule_days_of_week)
        : existing.schedule_days_of_week,
    schedule_day_of_month:
      body.schedule_day_of_month !== undefined ? body.schedule_day_of_month : existing.schedule_day_of_month,
    timeout_minutes: body.timeout_minutes ?? existing.timeout_minutes,
    updated_at: new Date().toISOString(),
  };

  const fields = Object.keys(merged);
  db.query(`UPDATE tasks SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`).run(
    ...(fields.map((f) => merged[f]) as (string | number | null)[]),
    id
  );

  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task;
  return c.json(serializeTask(row));
});

tasksRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
  return c.json({ ok: true });
});

tasksRouter.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const task = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
  if (!task) return c.json({ error: "Not found" }, 404);
  runTaskNow(id).catch((err) => console.error("[tasks] manual run failed:", err));
  return c.json({ ok: true, started: true });
});
