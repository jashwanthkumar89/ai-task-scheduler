import type { Task } from "../types";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

function isLastDayOfMonth(d: Date): boolean {
  const tomorrow = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return tomorrow.getMonth() !== d.getMonth();
}

/** True if `task` is due to fire at local time `now`, given it hasn't already fired this minute. */
export function isTaskDue(task: Task, now: Date): boolean {
  if (!task.enabled) return false;

  const key = minuteKey(now);
  if (task.last_triggered_minute === key) return false;

  const currentHHMM = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (currentHHMM !== task.schedule_time) return false;

  if (task.schedule_type === "daily") return true;

  if (task.schedule_type === "weekly") {
    const days: number[] = task.schedule_days_of_week ? JSON.parse(task.schedule_days_of_week) : [];
    return days.includes(now.getDay());
  }

  if (task.schedule_type === "monthly") {
    const dom = task.schedule_day_of_month ?? "1";
    if (dom === "last") return isLastDayOfMonth(now);
    return now.getDate() === parseInt(dom, 10);
  }

  return false;
}

export function describeSchedule(task: Task): string {
  if (task.schedule_type === "daily") return `Daily at ${task.schedule_time}`;
  if (task.schedule_type === "weekly") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days: number[] = task.schedule_days_of_week ? JSON.parse(task.schedule_days_of_week) : [];
    return `Weekly on ${days.map((d) => names[d]).join(", ")} at ${task.schedule_time}`;
  }
  const dom = task.schedule_day_of_month === "last" ? "last day" : `day ${task.schedule_day_of_month}`;
  return `Monthly on ${dom} at ${task.schedule_time}`;
}
