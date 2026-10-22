import { useEffect, useState } from "react";
import { api } from "../api";

function DailyChart({ days }: { days: { day: string; billableTokens: number }[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (days.length === 0) return <p className="hint">No usage yet this month.</p>;

  // Fill missing days between the first and last day so the axis is truthful.
  const byDay = new Map(days.map((d) => [d.day, d.billableTokens]));
  const filled: { day: string; billableTokens: number }[] = [];
  const cursor = new Date(days[0].day + "T12:00:00");
  const end = new Date(days[days.length - 1].day + "T12:00:00");
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    filled.push({ day: key, billableTokens: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const W = 720;
  const H = 200;
  const padL = 56;
  const padB = 24;
  const padT = 8;
  const max = Math.max(...filled.map((d) => d.billableTokens), 1);
  // Nice round-ish tick ceiling.
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const ceil = Math.ceil(max / magnitude) * magnitude;
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const barGap = 2;
  const barW = Math.max(2, plotW / filled.length - barGap);
  const ticks = 4;
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`);

  const hoveredDay = hovered != null ? filled[hovered] : null;
  const tooltipW = 140;
  const tooltipX = hovered != null
    ? Math.min(Math.max(padL + hovered * (plotW / filled.length) + barW / 2 - tooltipW / 2, 2), W - tooltipW - 2)
    : 0;

  return (
    <svg className="usage-chart" viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHovered(null)}>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (ceil / ticks) * i;
        const y = padT + plotH - (v / ceil) * plotH;
        return (
          <g key={i}>
            <line x1={padL} x2={W} y1={y} y2={y} className="chart-grid" />
            <text x={padL - 6} y={y + 4} textAnchor="end" className="chart-label">
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {filled.map((d, i) => {
        const h = (d.billableTokens / ceil) * plotH;
        const x = padL + i * (plotW / filled.length) + barGap / 2;
        return (
          <g key={d.day}>
            <rect
              x={x}
              y={padT}
              width={barW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHovered(i)}
            />
            <rect
              x={x}
              y={padT + plotH - h}
              width={barW}
              height={Math.max(h, 0.5)}
              className={hovered === i ? "chart-bar hovered" : "chart-bar"}
              pointerEvents="none"
            />
            {(filled.length <= 15 || i % Math.ceil(filled.length / 15) === 0) && (
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="chart-label">
                {Number(d.day.slice(8))}
              </text>
            )}
          </g>
        );
      })}
      {hoveredDay && (
        <g pointerEvents="none">
          <rect x={tooltipX} y={padT} width={tooltipW} height={34} rx={4} className="chart-tooltip" />
          <text x={tooltipX + tooltipW / 2} y={padT + 14} textAnchor="middle" className="chart-tooltip-label">
            {hoveredDay.day}
          </text>
          <text x={tooltipX + tooltipW / 2} y={padT + 27} textAnchor="middle" className="chart-tooltip-label strong">
            {`${hoveredDay.billableTokens.toLocaleString()} tokens`}
          </text>
        </g>
      )}
    </svg>
  );
}

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

      <h3>Tokens per day (this month)</h3>
      <DailyChart days={data.perDay} />

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
