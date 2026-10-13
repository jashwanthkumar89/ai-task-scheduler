import { useState } from "react";
import type { Category, ScheduleType, Task, TaskKind } from "../api";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-6", label: "Default (Sonnet 4.6)" },
  { value: "claude-opus-4-1", label: "Opus 4.1" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "sonnet", label: "sonnet (alias, latest)" },
  { value: "opus", label: "opus (alias, latest)" },
  { value: "haiku", label: "haiku (alias, latest)" },
];

export interface TaskFormValue {
  name: string;
  category: Category;
  kind: TaskKind;
  prompt: string;
  model: string;
  script_path: string;
  script_args: string;
  secrets_file: string;
  schedule_type: ScheduleType;
  schedule_time: string;
  schedule_days_of_week: number[];
  schedule_day_of_month: string;
  timeout_minutes: number;
}

function defaultsFor(category: Category): TaskFormValue {
  return {
    name: "",
    category,
    kind: category === "work" ? "claude" : "script",
    prompt: "",
    model: "claude-sonnet-4-6",
    script_path: "",
    script_args: "",
    secrets_file: "",
    schedule_type: "daily",
    schedule_time: "09:00",
    schedule_days_of_week: [1],
    schedule_day_of_month: "1",
    timeout_minutes: 15,
  };
}

export function taskToFormValue(task: Task): TaskFormValue {
  return {
    name: task.name,
    category: task.category,
    kind: task.kind,
    prompt: task.prompt ?? "",
    model: task.model ?? "claude-sonnet-4-6",
    script_path: task.script_path ?? "",
    script_args: task.script_args?.join(" ") ?? "",
    secrets_file: task.secrets_file ?? "",
    schedule_type: task.schedule_type,
    schedule_time: task.schedule_time,
    schedule_days_of_week: task.schedule_days_of_week?.length ? task.schedule_days_of_week : [1],
    schedule_day_of_month: task.schedule_day_of_month ?? "1",
    timeout_minutes: task.timeout_minutes,
  };
}

export function formValueToPayload(v: TaskFormValue): Partial<Task> {
  return {
    name: v.name,
    category: v.category,
    kind: v.kind,
    prompt: v.kind === "claude" ? v.prompt : null,
    model: v.kind === "claude" ? v.model : null,
    script_path: v.kind === "script" ? v.script_path : null,
    script_args: v.kind === "script" ? v.script_args.split(/\s+/).filter(Boolean) : [],
    secrets_file: v.kind === "script" ? v.secrets_file : null,
    schedule_type: v.schedule_type,
    schedule_time: v.schedule_time,
    schedule_days_of_week: v.schedule_type === "weekly" ? v.schedule_days_of_week : [],
    schedule_day_of_month: v.schedule_type === "monthly" ? v.schedule_day_of_month : null,
    timeout_minutes: v.timeout_minutes,
  };
}

export function TaskForm({
  category,
  initial,
  onCancel,
  onSubmit,
}: {
  category: Category;
  initial?: Task;
  onCancel: () => void;
  onSubmit: (value: TaskFormValue) => Promise<void>;
}) {
  const [value, setValue] = useState<TaskFormValue>(initial ? taskToFormValue(initial) : defaultsFor(category));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindOptions: TaskKind[] =
    category === "work" ? ["claude"] : ["script", "reminder", "claude"];

  function set<K extends keyof TaskFormValue>(key: K, val: TaskFormValue[K]) {
    setValue((prev) => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: number) {
    const days = value.schedule_days_of_week.includes(day)
      ? value.schedule_days_of_week.filter((d) => d !== day)
      : [...value.schedule_days_of_week, day].sort();
    set("schedule_days_of_week", days);
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input required value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Nightly repo review" />
      </label>

      <label>
        Type
        <select value={value.kind} onChange={(e) => set("kind", e.target.value as TaskKind)}>
          {kindOptions.map((k) => (
            <option key={k} value={k}>
              {k === "claude" ? "Claude Code task" : k === "script" ? "Script (Selenium/Python)" : "Reminder / checklist"}
            </option>
          ))}
        </select>
      </label>

      {value.kind === "claude" && (
        <>
          <label>
            Prompt (can invoke a skill, e.g. "/skill-name ...")
            <textarea
              required
              rows={4}
              value={value.prompt}
              onChange={(e) => set("prompt", e.target.value)}
              placeholder="Run the diagnosing-bugs skill on the latest failing CI job..."
            />
          </label>
          <label>
            Model
            <select value={value.model} onChange={(e) => set("model", e.target.value)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {value.kind === "script" && (
        <>
          <label>
            Script path
            <input
              required
              value={value.script_path}
              onChange={(e) => set("script_path", e.target.value)}
              placeholder="/Users/you/ai-task-scheduler/scripts/python/examples/sample_bill_task.py"
            />
          </label>
          <label>
            Script arguments (space separated, optional)
            <input value={value.script_args} onChange={(e) => set("script_args", e.target.value)} />
          </label>
          <label>
            Secrets file (.env with credentials for this task)
            <input
              value={value.secrets_file}
              onChange={(e) => set("secrets_file", e.target.value)}
              placeholder="/Users/you/ai-task-scheduler/scripts/secrets/internet_bill.env"
            />
          </label>
        </>
      )}

      {value.kind === "reminder" && (
        <p className="hint">
          A notification fires on schedule; mark it done from the run history once you've handled it by hand.
        </p>
      )}

      <fieldset>
        <legend>Schedule</legend>
        <label>
          Frequency
          <select value={value.schedule_type} onChange={(e) => set("schedule_type", e.target.value as ScheduleType)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        <label>
          Time of day
          <input type="time" value={value.schedule_time} onChange={(e) => set("schedule_time", e.target.value)} />
        </label>

        {value.schedule_type === "weekly" && (
          <div className="day-picker">
            {DAY_NAMES.map((name, idx) => (
              <button
                type="button"
                key={name}
                className={value.schedule_days_of_week.includes(idx) ? "day on" : "day"}
                onClick={() => toggleDay(idx)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {value.schedule_type === "monthly" && (
          <label>
            Day of month
            <select
              value={value.schedule_day_of_month}
              onChange={(e) => set("schedule_day_of_month", e.target.value)}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
              <option value="last">Last day of month</option>
            </select>
          </label>
        )}
      </fieldset>

      {value.kind !== "reminder" && (
        <label>
          Timeout (minutes)
          <input
            type="number"
            min={1}
            max={180}
            value={value.timeout_minutes}
            onChange={(e) => set("timeout_minutes", Number(e.target.value))}
          />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <div className="form-actions">
        <button type="button" onClick={onCancel} className="secondary">
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save task"}
        </button>
      </div>
    </form>
  );
}
