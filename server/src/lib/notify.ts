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

/** Push a notification to the user's phone via ntfy.sh (or a self-hosted
 * ntfy server). No-op unless the `ntfy_topic` setting is set. Never throws. */
export async function notifyMobile(
  title: string,
  message: string,
  opts: { priority?: number; tags?: string[] } = {},
): Promise<void> {
  const topic = getSetting("ntfy_topic");
  if (!topic) return;
  const server = (getSetting("ntfy_server") || "https://ntfy.sh").replace(/\/$/, "");
  try {
    const resp = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: String(opts.priority ?? 3),
        Tags: (opts.tags ?? []).join(","),
      },
      body: message,
    });
    if (!resp.ok) {
      console.error(`[ntfy] send failed: HTTP ${resp.status}`);
    }
  } catch (err) {
    console.error("[ntfy] failed to send mobile notification:", err);
  }
}

/** Push a notification to the user's devices via Pushover. No-op unless
 * both `pushover_user` and `pushover_token` settings are set. Never throws. */
export async function notifyPushover(
  title: string,
  message: string,
  opts: { priority?: number } = {},
): Promise<void> {
  const user = getSetting("pushover_user");
  const token = getSetting("pushover_token");
  if (!user || !token) return;
  try {
    const resp = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        user,
        title,
        message,
        priority: opts.priority ?? 0,
      }),
    });
    if (!resp.ok) {
      console.error(`[pushover] send failed: HTTP ${resp.status} ${await resp.text()}`);
    }
  } catch (err) {
    console.error("[pushover] failed to send notification:", err);
  }
}

/** Send to every configured mobile channel (ntfy + Pushover). */
export function notifyMobileAll(
  title: string,
  message: string,
  opts: { priority?: number; tags?: string[] } = {},
): void {
  void notifyMobile(title, message, opts);
  // Map ntfy-style 1-5 priorities to Pushover's -2..2 scale.
  const p = (opts.priority ?? 3) >= 5 ? 1 : 0;
  void notifyPushover(title, message, { priority: p });
}

export function notifyRunResult(
  taskName: string,
  status: "success" | "failed" | "timeout",
  detail?: string,
): void {
  const notifyOn = getSetting("notify_on") ?? "every_run";
  if (notifyOn === "none") return;
  if (notifyOn === "failures_only" && status === "success") return;

  // Pushover caps messages at 1024 chars; leave room for the header line.
  const tail = detail ? `\n\n${detail.slice(0, 900)}${detail.length > 900 ? "..." : ""}` : "";

  if (status === "success") {
    notify("Task Scheduler", `"${taskName}" completed successfully.`);
    notifyMobileAll("Task Scheduler", `"${taskName}" completed successfully.${tail}`, {
      priority: 3,
      tags: ["white_check_mark"],
    });
  } else if (status === "timeout") {
    notify("Task Scheduler", `"${taskName}" timed out and was killed.`, "Failed");
    notifyMobileAll("Task Scheduler", `"${taskName}" timed out and was killed.`, {
      priority: 5,
      tags: ["warning"],
    });
  } else {
    notify("Task Scheduler", `"${taskName}" failed. Check run history for details.`, "Failed");
    notifyMobileAll("Task Scheduler", `"${taskName}" failed. Check run history for details.`, {
      priority: 5,
      tags: ["rotating_light"],
    });
  }
}
