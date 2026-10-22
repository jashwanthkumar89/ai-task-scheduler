export type Category = "work" | "personal";
export type TaskKind = "claude" | "script" | "reminder";
export type ScheduleType = "daily" | "weekly" | "monthly";

export interface Task {
  id: string;
  name: string;
  category: Category;
  kind: TaskKind;
  enabled: 0 | 1;

  prompt: string | null;
  model: string | null;
  auto_approve: 0 | 1;

  script_path: string | null;
  script_args: string | null; // JSON
  secrets_file: string | null;

  schedule_type: ScheduleType;
  schedule_time: string; // "HH:MM"
  schedule_days_of_week: string | null; // JSON array of numbers
  schedule_day_of_month: string | null; // "1".."31" | "last"

  timeout_minutes: number;
  last_triggered_minute: string | null;
  created_at: string;
  updated_at: string;
}

export type RunTrigger = "schedule" | "manual";
export type RunStatus = "running" | "success" | "failed" | "timeout";

export interface Run {
  id: string;
  task_id: string;
  trigger: RunTrigger;
  status: RunStatus;
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
