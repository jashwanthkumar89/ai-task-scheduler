import { Hono } from "hono";
import { db } from "../db";
import { getMonthToDateUsage, getUsageByDay, getUsageByModel, getUsageByProject, startOfCurrentMonth } from "../lib/usage";

export const usageRouter = new Hono();

usageRouter.get("/", async (c) => {
  const monthToDate = await getMonthToDateUsage();
  const perProject = await getUsageByProject(startOfCurrentMonth());
  const perDay = await getUsageByDay(startOfCurrentMonth());
  const perModel = await getUsageByModel(startOfCurrentMonth());
  const spendUsd = perModel.reduce((s, m) => s + m.costUsd, 0);

  const perTask = db
    .query(
      `SELECT
         t.id as task_id,
         t.name as task_name,
         COUNT(r.id) as run_count,
         COALESCE(SUM(COALESCE(r.run_input_tokens,0) + COALESCE(r.run_output_tokens,0)), 0) as billable_tokens,
         COALESCE(SUM(COALESCE(r.run_cache_read_tokens,0) + COALESCE(r.run_cache_creation_tokens,0)), 0) as cache_tokens
       FROM tasks t
       LEFT JOIN runs r ON r.task_id = t.id AND r.started_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now')
       WHERE t.kind = 'claude'
       GROUP BY t.id
       ORDER BY billable_tokens DESC`
    )
    .all();

  const recentRuns = db
    .query(
      `SELECT id, task_id, started_at, model_used,
              (COALESCE(run_input_tokens,0) + COALESCE(run_output_tokens,0)) as billable_tokens,
              (COALESCE(run_cache_read_tokens,0) + COALESCE(run_cache_creation_tokens,0)) as cache_tokens
       FROM runs
       WHERE run_input_tokens IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 20`
    )
    .all();

  return c.json({ monthToDate, perTask, perProject, perModel, perDay, spendUsd, recentRuns });
});
