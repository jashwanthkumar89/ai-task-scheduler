#!/usr/bin/env bun
/**
 * MCP stdio server used as Claude Code's `--permission-prompt-tool`.
 *
 * Claude Code spawns this process per scheduled run (via --mcp-config) and calls the
 * `approve` tool whenever a tool call needs permission beyond what --permission-mode
 * already grants. We pop a native macOS dialog so you can Allow/Deny from your Mac;
 * if you don't respond within the timeout, it auto-denies so the run doesn't stall.
 *
 * Contract (undocumented but stable): the tool receives { tool_name, input, tool_use_id }
 * and must return a single text content block containing JSON:
 *   { "behavior": "allow", "updatedInput": {...} }
 *   { "behavior": "deny", "message": "..." }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_SECONDS = parseInt(process.env.PERMISSION_DIALOG_TIMEOUT_SECONDS ?? "120", 10);
const TASK_NAME = process.env.TASK_NAME ?? "Scheduled task";

function osaQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function askForApproval(toolName: string, input: unknown): Promise<boolean> {
  const inputPreview = JSON.stringify(input ?? {}).slice(0, 500);
  const message = `${TASK_NAME} wants to run: ${toolName}\n${inputPreview}`;
  const script = `display dialog ${osaQuote(message)} with title "Permission needed" buttons {"Deny", "Allow"} default button "Allow" giving up after ${TIMEOUT_SECONDS}`;

  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    // osascript prints e.g. "button returned:Allow, gave up:false"
    if (/gave up:true/.test(stdout)) return false; // timed out -> deny
    return /button returned:Allow/.test(stdout);
  } catch {
    // Dialog dismissed, osascript error, or no display attached -> fail closed.
    return false;
  }
}

const server = new McpServer({ name: "permgate", version: "0.1.0" });

server.registerTool(
  "approve",
  {
    description: "Decides whether a pending Claude Code tool call may run, via a macOS approval dialog.",
    inputSchema: {
      tool_name: z.string(),
      input: z.record(z.string(), z.unknown()).optional(),
      tool_use_id: z.string().optional(),
    },
  },
  async ({ tool_name, input }) => {
    const allowed = await askForApproval(tool_name, input ?? {});
    const result = allowed
      ? { behavior: "allow", updatedInput: input ?? {} }
      : { behavior: "deny", message: `Denied via scheduler approval dialog (timeout ${TIMEOUT_SECONDS}s or declined).` };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
