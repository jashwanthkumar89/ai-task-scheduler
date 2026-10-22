import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 };
}

async function walkJsonlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkJsonlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Sums token usage recorded by Claude Code's own local session logs
 * (~/.claude/projects/**\/*.jsonl) for assistant turns whose timestamp
 * falls within [since, until). Used to compute "tokens used this month"
 * by calling this once before a run and once after.
 */
export async function getTokenUsageSince(since: Date, until: Date = new Date()): Promise<UsageTotals> {
  const totals = emptyTotals();
  const seen = new Set<string>();
  const files = await walkJsonlFiles(PROJECTS_DIR);

  for (const file of files) {
    try {
      const fileStat = await stat(file);
      // A file not written to since `since` can't contain any lines in range.
      if (fileStat.mtime < since) continue;
    } catch {
      continue;
    }

    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "assistant") continue;
      const ts = record?.timestamp ? new Date(record.timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime())) continue;
      if (ts < since || ts >= until) continue;

      const usage = record?.message?.usage;
      if (!usage) continue;

      // Claude Code writes one transcript line per content block (text,
      // tool_use, ...) of the same assistant message, each repeating the
      // same usage object. Count each API request only once.
      const dedupeKey = `${record?.message?.id ?? ""}:${record?.requestId ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      totals.inputTokens += usage.input_tokens ?? 0;
      totals.outputTokens += usage.output_tokens ?? 0;
      totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      totals.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
    }
  }

  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens;
  return totals;
}

/** Claude Code mangles a project's cwd into a dir name by replacing "/"
 * and "." with "-" - ambiguous since real names can contain "-". Resolve
 * it by walking the fs: at each level, take the longest dash-joined
 * segment that exists on disk. Falls back to the raw name. */
function decodeProjectName(mangled: string): string {
  const rest = mangled.replace(/^-/, "");
  let path = "";
  let remaining = rest;
  while (remaining) {
    const parts = remaining.split("-");
    let found = "";
    let consumed = 0;
    for (let i = parts.length; i > 0; i--) {
      const candidate = parts.slice(0, i).join("-");
      if (existsSync(`${path}/${candidate}`)) {
        found = candidate;
        consumed = i;
        break;
      }
    }
    if (!found) return mangled; // can't decode reliably
    path += `/${found}`;
    remaining = parts.slice(consumed).join("-");
  }
  return path || mangled;
}

export interface ProjectUsage {
  project: string;
  billableTokens: number;
  cacheTokens: number;
}

/** Per-project billable + cache token totals since `since`, in one pass.
 * `project` is the working-directory path the transcripts belong to,
 * decoded from the mangled dir name ("/" and "." were replaced with "-"). */
export async function getUsageByProject(since: Date, until: Date = new Date()): Promise<ProjectUsage[]> {
  const seen = new Set<string>();
  const totals = new Map<string, { billable: number; cache: number }>();
  const files = await walkJsonlFiles(PROJECTS_DIR);

  for (const file of files) {
    try {
      const fileStat = await stat(file);
      if (fileStat.mtime < since) continue;
    } catch {
      continue;
    }
    // Project dir is the path component right under ~/.claude/projects.
    const rel = file.slice(PROJECTS_DIR.length + 1).split("/")[0];
    const project = decodeProjectName(rel);

    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "assistant") continue;
      const ts = record?.timestamp ? new Date(record.timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime()) || ts < since || ts >= until) continue;
      const usage = record?.message?.usage;
      if (!usage) continue;

      const dedupeKey = `${record?.message?.id ?? ""}:${record?.requestId ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const t = totals.get(project) ?? { billable: 0, cache: 0 };
      t.billable += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
      t.cache += (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      totals.set(project, t);
    }
  }

  return [...totals.entries()]
    .map(([project, t]) => ({ project, billableTokens: t.billable, cacheTokens: t.cache }))
    .sort((a, b) => b.billableTokens - a.billableTokens);
}

export interface ModelUsage {
  model: string;
  billableTokens: number;
  cacheTokens: number;
  costUsd: number;
}

// USD per 1M tokens: [input, output]. Cache reads cost ~10% of input,
// cache writes ~125%. Extend as new models land.
const MODEL_PRICING: [prefix: string, input: number, output: number][] = [
  ["claude-opus", 15, 75],
  ["claude-sonnet", 3, 15],
  ["claude-haiku", 0.8, 4],
];

function modelPrice(model: string): { input: number; output: number } {
  const m = (model || "").toLowerCase();
  for (const [prefix, input, output] of MODEL_PRICING) {
    if (m.includes(prefix)) return { input, output };
  }
  return { input: 3, output: 15 }; // assume sonnet
}

/** Per-model billable tokens + estimated cost since `since`, one pass. */
export async function getUsageByModel(since: Date, until: Date = new Date()): Promise<ModelUsage[]> {
  const seen = new Set<string>();
  const totals = new Map<string, { billable: number; cache: number; cost: number }>();
  const files = await walkJsonlFiles(PROJECTS_DIR);

  for (const file of files) {
    try {
      const fileStat = await stat(file);
      if (fileStat.mtime < since) continue;
    } catch {
      continue;
    }
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "assistant") continue;
      const ts = record?.timestamp ? new Date(record.timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime()) || ts < since || ts >= until) continue;
      const usage = record?.message?.usage;
      if (!usage) continue;

      const dedupeKey = `${record?.message?.id ?? ""}:${record?.requestId ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const model = record?.message?.model ?? "unknown";
      if (model === "<synthetic>") continue;
      const price = modelPrice(model);
      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheCreate = usage.cache_creation_input_tokens ?? 0;
      const cost =
        (input * price.input + output * price.output) / 1e6 +
        (cacheRead * price.input * 0.1 + cacheCreate * price.input * 1.25) / 1e6;

      const t = totals.get(model) ?? { billable: 0, cache: 0, cost: 0 };
      t.billable += input + output;
      t.cache += cacheRead + cacheCreate;
      t.cost += cost;
      totals.set(model, t);
    }
  }

  return [...totals.entries()]
    .map(([model, t]) => ({ model, billableTokens: t.billable, cacheTokens: t.cache, costUsd: t.cost }))
    .sort((a, b) => b.billableTokens - a.billableTokens);
}

export interface DayUsage {
  day: string; // YYYY-MM-DD, local time
  billableTokens: number;
}

/** Billable (input + output) tokens per calendar day since `since`, one pass. */
export async function getUsageByDay(since: Date, until: Date = new Date()): Promise<DayUsage[]> {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  const files = await walkJsonlFiles(PROJECTS_DIR);

  for (const file of files) {
    try {
      const fileStat = await stat(file);
      if (fileStat.mtime < since) continue;
    } catch {
      continue;
    }
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const line of content.split("\n")) {
      if (!line) continue;
      let record: any;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record?.type !== "assistant") continue;
      const ts = record?.timestamp ? new Date(record.timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime()) || ts < since || ts >= until) continue;
      const usage = record?.message?.usage;
      if (!usage) continue;

      const dedupeKey = `${record?.message?.id ?? ""}:${record?.requestId ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const p = (n: number) => String(n).padStart(2, "0");
      const day = `${ts.getFullYear()}-${p(ts.getMonth() + 1)}-${p(ts.getDate())}`;
      totals.set(day, (totals.get(day) ?? 0) + (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0));
    }
  }

  return [...totals.entries()]
    .map(([day, billableTokens]) => ({ day, billableTokens }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

/** Convenience: current month-to-date totals. */
export function getMonthToDateUsage(): Promise<UsageTotals> {
  return getTokenUsageSince(startOfCurrentMonth());
}
