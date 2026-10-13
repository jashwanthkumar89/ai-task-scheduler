import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "../types";
import { appendRunLog } from "../lib/runLog";

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(here, "..", "..", "..");
const SCRIPTS_DIR = join(PROJECT_ROOT, "scripts", "python");
const VENV_DIR = join(PROJECT_ROOT, "scripts", "venv");
const VENV_PYTHON = join(VENV_DIR, "bin", "python3");
const SCREENSHOTS_DIR = join(PROJECT_ROOT, "server", "data", "screenshots");

let venvReadyPromise: Promise<void> | null = null;

/** Lazily create/upgrade the shared venv the first time a script task runs. */
export function ensureVenv(): Promise<void> {
  if (venvReadyPromise) return venvReadyPromise;
  venvReadyPromise = (async () => {
    if (!existsSync(VENV_PYTHON)) {
      const bootstrap = Bun.spawn([process.execPath, "run", join(SCRIPTS_DIR, "bootstrap-venv.ts")], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await bootstrap.exited;
      if (exitCode !== 0) throw new Error("Failed to bootstrap Python venv");
    }
  })();
  return venvReadyPromise;
}

export interface ScriptRunResult {
  success: boolean;
  exitCode: number | null;
  output: string;
  errorMessage?: string;
  timedOut: boolean;
  screenshotPath: string | null;
}

const MAX_OUTPUT_CHARS = 20_000;

export async function runScriptTask(task: Task, runId: string, signal: AbortSignal): Promise<ScriptRunResult> {
  await ensureVenv();
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  if (!task.script_path || !existsSync(task.script_path)) {
    return {
      success: false,
      exitCode: null,
      output: "",
      errorMessage: `Script not found: ${task.script_path}`,
      timedOut: false,
      screenshotPath: null,
    };
  }

  const args: string[] = task.script_args ? JSON.parse(task.script_args) : [];
  const screenshotPath = join(SCREENSHOTS_DIR, `${runId}.png`);

  const env = {
    ...process.env,
    SECRETS_FILE: task.secrets_file ?? "",
    FAILURE_SCREENSHOT_PATH: screenshotPath,
  };

  return new Promise<ScriptRunResult>((resolve) => {
    const child = spawn(VENV_PYTHON, ["-u", task.script_path as string, ...args], { env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const onAbort = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort);

    child.stdout.on("data", (chunk) => {
      appendRunLog(runId, chunk);
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      appendRunLog(runId, chunk);
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(-MAX_OUTPUT_CHARS);
    });

    child.on("close", (exitCode) => {
      signal.removeEventListener("abort", onAbort);
      const success = !timedOut && exitCode === 0;
      resolve({
        success,
        exitCode,
        output: `${stdout}\n${stderr}`.trim().slice(-MAX_OUTPUT_CHARS),
        errorMessage: timedOut ? "Timed out" : !success ? stderr.slice(-2000) || "Non-zero exit" : undefined,
        timedOut,
        screenshotPath: !success && existsSync(screenshotPath) ? screenshotPath : null,
      });
    });

    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      resolve({
        success: false,
        exitCode: null,
        output: stdout || stderr,
        errorMessage: `Failed to spawn script: ${err.message}`,
        timedOut: false,
        screenshotPath: null,
      });
    });
  });
}
