import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(here, "..", "..", "data", "logs");
const NOTES_DIR = join(here, "..", "..", "data", "notes");

export function runLogPath(runId: string): string {
  return join(LOGS_DIR, `${runId}.log`);
}

/** Append a chunk of process output to the run's live log file. Never throws. */
export function appendRunLog(runId: string, chunk: string | Buffer): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(runLogPath(runId), chunk);
  } catch {
    // logging must never break a run
  }
}

export function readRunLog(runId: string): string | null {
  const path = runLogPath(runId);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Write a run's human-readable result to data/notes/<date>-<HHMM>-<task-slug>.md
 * (one file per run). Returns the file path, or null if writing failed. Never throws. */
export function writeRunNote(taskName: string, markdown: string): string | null {
  try {
    mkdirSync(NOTES_DIR, { recursive: true });
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const hhmm = `${p(now.getHours())}${p(now.getMinutes())}`;
    const slug = taskName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const path = join(NOTES_DIR, `${date}-${hhmm}-${slug}.md`);
    writeFileSync(path, `# ${taskName} - ${now.toLocaleString()}\n\n${markdown}\n`, "utf8");
    return path;
  } catch {
    return null;
  }
}
