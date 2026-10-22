import { Hono } from "hono";
import { getSetting, setSetting } from "../db";
import { notifyMobileAll } from "../lib/notify";

export const settingsRouter = new Hono();

const KNOWN_KEYS = [
  "default_working_dir",
  "notify_on",
  "ntfy_topic",
  "ntfy_server",
  "pushover_user",
  "pushover_token",
] as const;

settingsRouter.get("/", (c) => {
  const result: Record<string, string> = {};
  for (const key of KNOWN_KEYS) {
    result[key] = getSetting(key) ?? "";
  }
  return c.json(result);
});

settingsRouter.patch("/", async (c) => {
  const body = await c.req.json();
  for (const key of KNOWN_KEYS) {
    if (body[key] !== undefined) setSetting(key, String(body[key]));
  }
  const result: Record<string, string> = {};
  for (const key of KNOWN_KEYS) result[key] = getSetting(key) ?? "";
  return c.json(result);
});

settingsRouter.post("/test-ntfy", async (c) => {
  if (!getSetting("ntfy_topic") && !getSetting("pushover_user")) {
    return c.json({ ok: false, error: "Set an ntfy topic or Pushover keys first." }, 400);
  }
  notifyMobileAll("Task Scheduler", "Test notification from AI Task Scheduler.", {
    priority: 4,
    tags: ["iphone"],
  });
  return c.json({ ok: true });
});
