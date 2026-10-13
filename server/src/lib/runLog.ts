import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(here, "..", "..", "data", "logs");

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
