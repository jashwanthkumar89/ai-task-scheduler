import { Hono } from "hono";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NOTES_DIR = join(here, "..", "..", "data", "notes");

export const notesRouter = new Hono();

function safeName(name: string): string | null {
  const base = basename(name);
  return /^[\w.-]+\.md$/.test(base) ? base : null;
}

notesRouter.get("/", (c) => {
  mkdirSync(NOTES_DIR, { recursive: true });
  const files = readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
  return c.json(
    files.map((f) => {
      // New format: YYYY-MM-DD-HHMM-slug.md; legacy: YYYY-MM-DD-slug.md
      const m = f.match(/^(\d{4}-\d{2}-\d{2})-(\d{4})-(.+)\.md$/);
      return {
        file: f,
        date: m ? m[1] : f.slice(0, 10),
        time: m ? `${m[2].slice(0, 2)}:${m[2].slice(2)}` : null,
        title: (m ? m[3] : f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "")).replace(/-/g, " "),
      };
    }),
  );
});

notesRouter.get("/:file", (c) => {
  const name = safeName(c.req.param("file"));
  if (!name) return c.json({ error: "Bad name" }, 400);
  try {
    return c.json({ file: name, content: readFileSync(join(NOTES_DIR, name), "utf8") });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

notesRouter.put("/:file", async (c) => {
  const name = safeName(c.req.param("file"));
  if (!name) return c.json({ error: "Bad name" }, 400);
  const body = await c.req.json();
  if (typeof body.content !== "string") return c.json({ error: "content required" }, 400);
  writeFileSync(join(NOTES_DIR, name), body.content, "utf8");
  return c.json({ ok: true });
});
