import { Hono } from "hono";
import { getSetting, setSetting } from "../db";

export const settingsRouter = new Hono();

const KNOWN_KEYS = ["default_working_dir", "notify_on"] as const;

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
