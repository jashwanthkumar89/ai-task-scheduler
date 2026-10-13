import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMonthToDateUsage } from "../lib/usage";
import { getSetting } from "../db";
import type { Task } from "../types";
import { appendRunLog } from "../lib/runLog";

const here = dirname(fileURLToPath(import.meta.url));
const PERMISSION_SERVER_PATH = join(here, "..", "mcp", "permission-server.ts");

export interface ClaudeRunResult {
  success: boolean;
  exitCode: number | null;
  output: string;
  errorMessage?: string;
  timedOut: boolean;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
    modelUsed: string | null;
  };
  monthlyTotalBefore: number;
  monthlyTotalAfter: number;
}

const MAX_OUTPUT_CHARS = 20_000;

export async function runClaudeTask(task: Task, signal: AbortSignal, runId?: string): Promise<ClaudeRunResult> {
  const cwd = getSetting("default_working_dir") ?? process.env.HOME ?? "/";
  const model = task.model || "sonnet";

  const monthlyBefore = (await getMonthToDateUsage()).totalTokens;

  const mcpConfig = JSON.stringify({
    mcpServers: {
      permgate: {
        command: process.execPath,
        args: ["run", PERMISSION_SERVER_PATH],
        env: { TASK_NAME: task.name },
      },
    },
  });

  const args = [
    "-p",
    task.prompt ?? "",
    "--model",
    model,
    "--permission-mode",
    "acceptEdits",
    "--output-format",
    "json",
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--permission-prompt-tool",
    "mcp__permgate__approve",
  ];

  const result = await new Promise<ClaudeRunResult>((resolve) => {
    const child = spawn("claude", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const onAbort = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort);

    child.stdout.on("data", (chunk) => {
      if (runId) appendRunLog(runId, chunk);
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_CHARS) stdout = stdout.slice(-MAX_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      if (runId) appendRunLog(runId, chunk);
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_CHARS) stderr = stderr.slice(-MAX_OUTPUT_CHARS);
    });

    child.on("close", async (exitCode) => {
      signal.removeEventListener("abort", onAbort);
      const monthlyAfter = (await getMonthToDateUsage()).totalTokens;

      let parsed: any = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // non-JSON output (e.g. crashed before producing a result) - fall through
      }

      const usage = parsed?.usage ?? null;
      const resolvedModelId = parsed?.modelUsage ? Object.keys(parsed.modelUsage)[0] : null;

      resolve({
        success: !timedOut && exitCode === 0,
        exitCode,
        output: (stdout || stderr).slice(-MAX_OUTPUT_CHARS),
        errorMessage: timedOut ? "Timed out" : exitCode !== 0 ? stderr.slice(-2000) || "Non-zero exit" : undefined,
        timedOut,
        usage: {
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          cacheReadTokens: usage?.cache_read_input_tokens ?? null,
          cacheCreationTokens: usage?.cache_creation_input_tokens ?? null,
          modelUsed: resolvedModelId ?? model,
        },
        monthlyTotalBefore: monthlyBefore,
        monthlyTotalAfter: monthlyAfter,
      });
    });

    child.on("error", async (err) => {
      signal.removeEventListener("abort", onAbort);
      const monthlyAfter = (await getMonthToDateUsage()).totalTokens;
      resolve({
        success: false,
        exitCode: null,
        output: stdout || stderr,
        errorMessage: `Failed to spawn claude: ${err.message}`,
        timedOut: false,
        usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, modelUsed: model },
        monthlyTotalBefore: monthlyBefore,
        monthlyTotalAfter: monthlyBefore,
      });
    });
  });

  return result;
}
