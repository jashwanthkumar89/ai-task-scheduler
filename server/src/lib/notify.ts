import { spawn } from "node:child_process";
import { getSetting } from "../db";

/** Fire-and-forget macOS notification. Never throws. */
export function notify(title: string, message: string, subtitle?: string): void {
  if (process.platform !== "darwin") {
    console.log(`[notify] ${title}: ${message}`);
    return;
  }
  const script = `display notification ${osaQuote(message)} with title ${osaQuote(title)}${
    subtitle ? ` subtitle ${osaQuote(subtitle)}` : ""
  }`;
  try {
    const child = spawn("osascript", ["-e", script], { stdio: "ignore" });
    child.unref();
  } catch (err) {
    console.error("[notify] failed to send notification:", err);
  }
}

function osaQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function notifyRunResult(taskName: string, status: "success" | "failed" | "timeout"): void {
  const notifyOn = getSetting("notify_on") ?? "every_run";
  if (notifyOn === "none") return;
  if (notifyOn === "failures_only" && status === "success") return;

  if (status === "success") {
    notify("Task Scheduler", `"${taskName}" completed successfully.`);
  } else if (status === "timeout") {
    notify("Task Scheduler", `"${taskName}" timed out and was killed.`, "Failed");
  } else {
    notify("Task Scheduler", `"${taskName}" failed. Check run history for details.`, "Failed");
  }
}
