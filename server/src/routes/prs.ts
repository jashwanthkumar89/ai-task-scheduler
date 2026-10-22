import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { db } from "../db";
import type { Task } from "../types";
import { runClaudeTask } from "../runners/claudeRunner";
import { writeRunNote } from "../lib/runLog";
import { notifyRunResult } from "../lib/notify";

const execFileAsync = promisify(execFile);
const REPOS_DIR = join(process.env.HOME ?? "/", "Intus");
const REVIEW_TIMEOUT_MS = 20 * 60_000;

/** Resolve a GitHub "owner/repo" to the local checkout under ~/Intus
 * (case-insensitive directory name match). */
function findRepoDir(nameWithOwner: string): string | null {
  const name = nameWithOwner.split("/").pop()!.toLowerCase();
  try {
    for (const entry of readdirSync(REPOS_DIR)) {
      if (entry.toLowerCase() === name && existsSync(join(REPOS_DIR, entry, ".git"))) {
        return join(REPOS_DIR, entry);
      }
    }
  } catch {
    // REPOS_DIR missing
  }
  return null;
}

const FIELDS = "number,title,url,state,updatedAt,isDraft,repository,author";

interface GhPr {
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string;
  isDraft: boolean;
  repository: { nameWithOwner: string };
  author: { login: string };
}

async function ghSearch(query: string[]): Promise<GhPr[]> {
  const { stdout } = await execFileAsync(
    "gh",
    ["search", "prs", ...query, "--state", "open", "--json", FIELDS, "--limit", "50"],
    { timeout: 30_000 },
  );
  return JSON.parse(stdout) as GhPr[];
}

export const prsRouter = new Hono();

prsRouter.get("/", async (c) => {
  try {
    const [mine, reviewRequested] = await Promise.all([
      ghSearch(["--author", "@me"]),
      ghSearch(["--review-requested", "@me"]),
    ]);
    const shape = (pr: GhPr) => ({
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      draft: pr.isDraft,
      updatedAt: pr.updatedAt,
      author: pr.author.login,
    });
    return c.json({ mine: mine.map(shape), reviewRequested: reviewRequested.map(shape) });
  } catch (err: any) {
    return c.json({ error: `gh failed: ${err?.stderr ?? err?.message ?? err}` }, 500);
  }
});

// Latest review state per PR, for the dashboard.
prsRouter.get("/reviews", (c) => {
  const rows = db.query("SELECT * FROM pr_reviews ORDER BY started_at DESC").all();
  return c.json(rows);
});

prsRouter.post("/review", async (c) => {
  const body = await c.req.json();
  const { repo, number, title, url } = body ?? {};
  if (typeof repo !== "string" || typeof number !== "number") {
    return c.json({ error: "repo and number required" }, 400);
  }

  const dir = findRepoDir(repo);
  if (!dir) {
    return c.json({ error: `No local checkout for ${repo} under ${REPOS_DIR}` }, 400);
  }

  const existing = db
    .query("SELECT status FROM pr_reviews WHERE repo = ? AND number = ?")
    .get(repo, number) as { status: string } | undefined;
  if (existing?.status === "running") {
    return c.json({ error: "Review already running" }, 409);
  }

  const isChomp = basename(dir).toLowerCase() === "chomp";
  const prompt = isChomp
    ? `/code-review-and-quality Review pull request #${number} in this repository (${url ?? ""}). ` +
      `Use the gh CLI to fetch the PR diff and metadata. Produce the full structured review.`
    : `/review_code --repo=. --branch=current --pr=${number}` +
      (url ? ` PR URL: ${url}` : "");

  db.query(
    `INSERT INTO pr_reviews (repo, number, title, url, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       status = 'running', started_at = excluded.started_at,
       finished_at = NULL, output = NULL, error_message = NULL, note_file = NULL,
       title = excluded.title, url = excluded.url`
  ).run(repo, number, title ?? null, url ?? null, new Date().toISOString());

  // Run in the background; the endpoint returns immediately.
  const task = {
    id: `pr-review-${repo}-${number}`,
    name: `PR review ${repo.split("/").pop()}#${number}`,
    kind: "claude",
    prompt,
    model: "sonnet",
    auto_approve: 1,
  } as Task;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);

  runClaudeTask(task, controller.signal, undefined, dir)
    .then((result) => {
      const status = result.timedOut ? "timeout" : result.success ? "success" : "failed";
      let noteFile: string | null = null;
      if (result.resultText) {
        const p = writeRunNote(`PR review ${repo.split("/").pop()} #${number}`, result.resultText);
        noteFile = p ? basename(p) : null;
      }
      db.query(
        `UPDATE pr_reviews SET status=?, finished_at=?, output=?, error_message=?, note_file=?
         WHERE repo=? AND number=?`
      ).run(
        status,
        new Date().toISOString(),
        result.resultText ?? result.output,
        result.errorMessage ?? null,
        noteFile,
        repo,
        number
      );
      notifyRunResult(task.name, status, result.resultText ?? undefined);
    })
    .catch((err) => {
      db.query(
        `UPDATE pr_reviews SET status='failed', finished_at=?, error_message=? WHERE repo=? AND number=?`
      ).run(new Date().toISOString(), String(err?.message ?? err), repo, number);
    })
    .finally(() => clearTimeout(timer));

  return c.json({ ok: true, dir, prompt });
});
