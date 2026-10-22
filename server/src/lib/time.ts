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

function isDueToday(task: Task, now: Date): boolean {
  if (task.schedule_type === "daily") return true;
  if (task.schedule_type === "weekly") {
    const days: number[] = task.schedule_days_of_week ? JSON.parse(task.schedule_days_of_week) : [];
    return days.includes(now.getDay());
  }
  const dom = task.schedule_day_of_month ?? "1";
  if (dom === "last") return isLastDayOfMonth(now);
  return now.getDate() === parseInt(dom, 10);
}

/** True if `task` is due at local time `now`. Fires when the schedule time
 * arrives; if that minute was missed (server down, Mac asleep), fires at the
 * next tick as long as today's due time has passed and it hasn't run yet. */
export function isTaskDue(task: Task, now: Date): boolean {
  if (!task.enabled) return false;
  if (!isDueToday(task, now)) return false;

  const dueTodayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T${task.schedule_time}`;
  return minuteKey(now) >= dueTodayKey && (task.last_triggered_minute ?? "") < dueTodayKey;
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
