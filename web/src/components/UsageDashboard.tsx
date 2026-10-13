import { useEffect, useState } from "react";
import { api } from "../api";

export function UsageDashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getUsage>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => api.getUsage().then((d) => !cancelled && setData(d)).catch(() => {});
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) return <p className="hint">Loading usage...</p>;

  return (
    <div className="usage-dashboard">
      <h2>Token usage</h2>

      <div className="usage-cards">
        <div className="usage-card">
          <span className="usage-label">Month-to-date (input + output)</span>
          <span className="usage-value">
            {(data.monthToDate.inputTokens + data.monthToDate.outputTokens).toLocaleString()}
          </span>
        </div>
        <div className="usage-card">
          <span className="usage-label">Input</span>
          <span className="usage-value">{data.monthToDate.inputTokens.toLocaleString()}</span>
        </div>
        <div className="usage-card">
          <span className="usage-label">Output</span>
          <span className="usage-value">{data.monthToDate.outputTokens.toLocaleString()}</span>
        </div>
        <div className="usage-card">
          <span className="usage-label">Est. spend (of $300)</span>
          <span className="usage-value">${data.spendUsd.toFixed(2)}</span>
          <div className="usage-progress">
            <div
              className="usage-progress-fill"
              style={{ width: `${Math.min(100, (data.spendUsd / 300) * 100)}%` }}
            />
          </div>
          <span className="hint">{Math.max(0, 300 - data.spendUsd).toFixed(2)} remaining</span>
        </div>
      </div>
      <p className="hint">
        Computed from Claude Code's own local session logs (~/.claude/projects) for this calendar month -
        covers all Claude Code usage on this machine, not just scheduled tasks. Token counts are
        billable input + output only. The cost estimate also includes prompt-cache reads/writes,
        billed at roughly 10%/125% of input price.
      </p>

      <h3>By model (this month)</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Tokens</th>
            <th>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {data.perModel.map((row) => (
            <tr key={row.model}>
              <td className="mono">{row.model}</td>
              <td>{row.billableTokens.toLocaleString()}</td>
              <td>${row.costUsd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By project (this month)</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {data.perProject.map((row) => (
            <tr key={row.project}>
              <td className="mono">{row.project}</td>
              <td>{row.billableTokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By scheduled task (this month)</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Runs</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {data.perTask.map((row) => (
            <tr key={row.task_id}>
              <td>{row.task_name}</td>
              <td>{row.run_count}</td>
              <td>{row.billable_tokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Recent scheduled runs</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Model</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {data.recentRuns.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.started_at).toLocaleString()}</td>
              <td>{row.model_used}</td>
              <td>{row.billable_tokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
