import { randomUUID } from "node:crypto";
import { db, getSetting } from "./db";
import type { Run, Task } from "./types";
import { isTaskDue, minuteKey } from "./lib/time";
import { notifyRunResult, notify } from "./lib/notify";
import { runClaudeTask } from "./runners/claudeRunner";
import { runScriptTask } from "./runners/scriptRunner";
import { writeRunNote } from "./lib/runLog";
import { basename } from "node:path";

const TICK_MS = 30_000;
const runningTaskIds = new Set<string>();

function getAllTasks(): Task[] {
  return db.query("SELECT * FROM tasks").all() as Task[];
}

function getTask(id: string): Task | undefined {
  return db.query("SELECT * FROM tasks WHERE id = ?").get(id) as Task | undefined;
}

function insertRun(taskId: string, trigger: "schedule" | "manual"): Run {
  const run: Run = {
    id: randomUUID(),
    task_id: taskId,
    trigger,
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    exit_code: null,
    output: null,
    error_message: null,
    screenshot_path: null,
    note_file: null,
    run_input_tokens: null,
    run_output_tokens: null,
    run_cache_read_tokens: null,
    run_cache_creation_tokens: null,
    model_used: null,
    monthly_total_tokens_before: null,
    monthly_total_tokens_after: null,
  };
  db.query(
    `INSERT INTO runs (id, task_id, trigger, status, started_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(run.id, run.task_id, run.trigger, run.status, run.started_at);
  return run;
}

function finishRun(runId: string, patch: Partial<Run>): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => (patch as any)[f]);
  db.query(`UPDATE runs SET ${setClause} WHERE id = ?`).run(...values, runId);
}

/** Executes a single task run to completion (used by both schedule and manual triggers). */
export async function executeTask(task: Task, trigger: "schedule" | "manual"): Promise<void> {
  if (runningTaskIds.has(task.id)) {
    console.log(`[scheduler] skipping ${task.name}: already running`);
    return;
  }
  runningTaskIds.add(task.id);
  const run = insertRun(task.id, trigger);

  try {
    if (task.kind === "reminder") {
      // Reminder tasks stay "running" (= pending) until manually marked complete via the UI.
      notify("Task Scheduler", `"${task.name}" is due.`, "Reminder");
      return;
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), task.timeout_minutes * 60_000);

    try {
      if (task.kind === "claude") {
        const result = await runClaudeTask(task, controller.signal, run.id);
        finishRun(run.id, {
          status: result.timedOut ? "timeout" : result.success ? "success" : "failed",
          finished_at: new Date().toISOString(),
          exit_code: result.exitCode,
          output: result.output,
          error_message: result.errorMessage ?? null,
          run_input_tokens: result.usage.inputTokens,
          run_output_tokens: result.usage.outputTokens,
          run_cache_read_tokens: result.usage.cacheReadTokens,
          run_cache_creation_tokens: result.usage.cacheCreationTokens,
          model_used: result.usage.modelUsed,
          monthly_total_tokens_before: result.monthlyTotalBefore,
          monthly_total_tokens_after: result.monthlyTotalAfter,
        });
        if (result.resultText) {
          const notePath = writeRunNote(task.name, result.resultText);
          if (notePath) {
            console.log(`[scheduler] note written: ${notePath}`);
            finishRun(run.id, { note_file: basename(notePath) });
          }
        }
        notifyRunResult(
          task.name,
          result.timedOut ? "timeout" : result.success ? "success" : "failed",
          result.resultText ?? undefined,
        );
      } else if (task.kind === "script") {
        const result = await runScriptTask(task, run.id, controller.signal);
        finishRun(run.id, {
          status: result.timedOut ? "timeout" : result.success ? "success" : "failed",
          finished_at: new Date().toISOString(),
          exit_code: result.exitCode,
          output: result.output,
          error_message: result.errorMessage ?? null,
          screenshot_path: result.screenshotPath,
        });
        // Quiet exits ("[QUIET]" in output, e.g. a bill script finding
        // nothing new) record as success but skip all notifications.
        const quiet = (result.output ?? "").includes("[QUIET]");
        if (!quiet) {
          notifyRunResult(task.name, result.timedOut ? "timeout" : result.success ? "success" : "failed");
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch (err: any) {
    finishRun(run.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: err?.message ?? String(err),
    });
    notifyRunResult(task.name, "failed");
  } finally {
    runningTaskIds.delete(task.id);
  }
}

function tick(): void {
  const now = new Date();
  for (const task of getAllTasks()) {
    if (!isTaskDue(task, now)) continue;

    db.query("UPDATE tasks SET last_triggered_minute = ? WHERE id = ?").run(minuteKey(now), task.id);

    executeTask(task, "schedule").catch((err) => {
      console.error(`[scheduler] unhandled error running task ${task.id}:`, err);
    });
  }
}

export function startScheduler(): void {
  console.log(`[scheduler] starting, tick every ${TICK_MS / 1000}s`);
  tick();
  setInterval(tick, TICK_MS);
}

export function isTaskRunning(taskId: string): boolean {
  return runningTaskIds.has(taskId);
}

export function runTaskNow(taskId: string): Promise<void> {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found");
  // Stamp the trigger marker so a manual run suppresses a missed scheduled
  // catch-up for a due time that has already passed today.
  db.query("UPDATE tasks SET last_triggered_minute = ? WHERE id = ?").run(minuteKey(new Date()), taskId);
  return executeTask(task, "manual");
}
