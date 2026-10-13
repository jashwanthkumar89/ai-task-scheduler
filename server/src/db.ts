import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = join(DATA_DIR, "scheduler.sqlite");

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('work', 'personal')),
  kind TEXT NOT NULL CHECK (kind IN ('claude', 'script', 'reminder')),
  enabled INTEGER NOT NULL DEFAULT 1,

  -- claude task fields
  prompt TEXT,
  model TEXT,

  -- script task fields
  script_path TEXT,
  script_args TEXT,       -- JSON array of strings
  secrets_file TEXT,      -- path to a per-task .env file

  -- schedule
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
  schedule_time TEXT NOT NULL,     -- "HH:MM" local time
  schedule_days_of_week TEXT,      -- JSON array of 0-6 (Sun=0), for weekly
  schedule_day_of_month TEXT,      -- "1".."31" or "last", for monthly

  timeout_minutes INTEGER NOT NULL DEFAULT 15,

  last_triggered_minute TEXT,      -- "YYYY-MM-DDTHH:MM" guard against double-fire
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  output TEXT,                 -- captured stdout/stderr (truncated)
  error_message TEXT,
  screenshot_path TEXT,        -- for failed selenium runs

  -- token usage for claude runs
  run_input_tokens INTEGER,
  run_output_tokens INTEGER,
  run_cache_read_tokens INTEGER,
  run_cache_creation_tokens INTEGER,
  model_used TEXT,
  monthly_total_tokens_before INTEGER,
  monthly_total_tokens_after INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
`);

export function getSetting(key: string): string | undefined {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.query(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

// Sensible defaults
if (getSetting("default_working_dir") === undefined) {
  setSetting("default_working_dir", process.env.HOME ?? "/");
}
if (getSetting("notify_on") === undefined) {
  setSetting("notify_on", "every_run");
}
