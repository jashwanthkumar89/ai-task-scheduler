export type Category = "work" | "personal";
export type TaskKind = "claude" | "script" | "reminder";
export type ScheduleType = "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  name: string;
  category: Category;
  kind: TaskKind;
  enabled: boolean;
  running: boolean;

  prompt: string | null;
  model: string | null;
  auto_approve: boolean;

  script_path: string | null;
  script_args: string[];
  secrets_file: string | null;

  schedule_type: ScheduleType;
  schedule_time: string;
  schedule_days_of_week: number[];
  schedule_day_of_month: string | null;

  timeout_minutes: number;
  schedule_description: string;
  created_at: string;
}

export interface Run {
  id: string;
  task_id: string;
  trigger: "schedule" | "manual";
  status: "running" | "success" | "failed" | "timeout";
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  output: string | null;
  error_message: string | null;
  screenshot_path: string | null;
  note_file: string | null;
  run_input_tokens: number | null;
  run_output_tokens: number | null;
  run_cache_read_tokens: number | null;
  run_cache_creation_tokens: number | null;
  model_used: string | null;
  monthly_total_tokens_before: number | null;
  monthly_total_tokens_after: number | null;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

export const api = {
  listTasks: (category?: Category) =>
    request<Task[]>(`/tasks${category ? `?category=${category}` : ""}`),
  createTask: (task: Partial<Task>) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  updateTask: (id: string, patch: Partial<Task>) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<{ ok: true }>(`/tasks/${id}`, { method: "DELETE" }),
  runTaskNow: (id: string) => request<{ ok: true }>(`/tasks/${id}/run`, { method: "POST" }),

  listRuns: (taskId?: string) => request<Run[]>(`/runs${taskId ? `?taskId=${taskId}` : ""}`),
  completeRun: (id: string) => request<Run>(`/runs/${id}/complete`, { method: "POST" }),
  getRunLog: (id: string) => request<{ log: string }>(`/runs/${id}/log`),

  getSettings: () => request<Record<string, string>>("/settings"),
  updateSettings: (patch: Record<string, string>) =>
    request<Record<string, string>>("/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  testNtfy: () => request<{ ok: boolean }>("/settings/test-ntfy", { method: "POST" }),

  listNotes: () =>
    request<{ file: string; date: string; time: string | null; title: string }[]>("/notes"),
  getNote: (file: string) => request<{ file: string; content: string }>(`/notes/${file}`),
  saveNote: (file: string, content: string) =>
    request<{ ok: true }>(`/notes/${file}`, { method: "PUT", body: JSON.stringify({ content }) }),

  getPrs: () =>
    request<{
      mine: { repo: string; number: number; title: string; url: string; draft: boolean; updatedAt: string; author: string; reviewDecision: string | null }[];
      reviewRequested: { repo: string; number: number; title: string; url: string; draft: boolean; updatedAt: string; author: string; reviewDecision: string | null }[];
    }>("/prs"),
  listPrReviews: () =>
    request<
      {
        repo: string;
        number: number;
        title: string | null;
        url: string | null;
        status: "running" | "success" | "failed" | "timeout";
        started_at: string;
        finished_at: string | null;
        output: string | null;
        error_message: string | null;
        note_file: string | null;
      }[]
    >("/prs/reviews"),
  reviewPr: (pr: { repo: string; number: number; title: string; url: string }) =>
    request<{ ok: true; dir: string }>("/prs/review", {
      method: "POST",
      body: JSON.stringify(pr),
    }),

  getUsage: () =>
    request<{
      monthToDate: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number };
      perTask: { task_id: string; task_name: string; run_count: number; billable_tokens: number; cache_tokens: number }[];
      perProject: { project: string; billableTokens: number; cacheTokens: number }[];
      perModel: { model: string; billableTokens: number; cacheTokens: number; costUsd: number }[];
      perDay: { day: string; billableTokens: number }[];
      spendUsd: number;
      recentRuns: { id: string; task_id: string; started_at: string; model_used: string; billable_tokens: number; cache_tokens: number }[];
    }>("/usage"),
};
