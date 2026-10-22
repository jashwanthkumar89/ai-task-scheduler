import { useEffect, useState } from "react";
import { api, type Run } from "../api";

function statusBadge(status: Run["status"]) {
  const labels: Record<Run["status"], string> = {
    running: "Pending",
    success: "Success",
    failed: "Failed",
    timeout: "Timed out",
  };
  return <span className={`badge badge-${status}`}>{labels[status]}</span>;
}

export function RunHistory({ taskId, refreshKey }: { taskId: string; refreshKey: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      setRuns(await api.listRuns(taskId));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [taskId, refreshKey]);

  // Poll while any run is in-flight so its status updates live.
  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const interval = setInterval(() => load(true), 3000);
    return () => clearInterval(interval);
  }, [anyRunning, taskId]);

  async function markDone(runId: string) {
    await api.completeRun(runId);
    load();
  }

  if (loading) return <p className="hint">Loading history...</p>;
  if (runs.length === 0) return <p className="hint">No runs yet.</p>;

  return (
    <div className="run-history">
      {runs.map((run) => {
        const tokenTotal = (run.run_input_tokens ?? 0) + (run.run_output_tokens ?? 0);
        return (
          <div className="run-row" key={run.id}>
            <div className="run-summary" onClick={() => setExpanded(expanded === run.id ? null : run.id)}>
              <span className="run-time">{new Date(run.started_at).toLocaleString()}</span>
              <span className="run-trigger">{run.trigger}</span>
              {statusBadge(run.status)}
              {tokenTotal > 0 && <span className="run-tokens">{tokenTotal.toLocaleString()} tokens</span>}
              {run.status === "running" && (
                <button
                  className="secondary small"
                  onClick={(e) => {
                    e.stopPropagation();
                    markDone(run.id);
                  }}
                >
                  Mark done
                </button>
              )}
            </div>
            {expanded === run.id && (
              <RunDetail run={run} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunDetail({ run }: { run: Run }) {
  const [liveLog, setLiveLog] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const { log } = await api.getRunLog(run.id);
        if (!cancelled) setLiveLog(log);
      } catch {
        // ignore transient errors while polling
      }
    }
    poll();
    const interval = run.status === "running" ? setInterval(poll, 3000) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [run.id, run.status]);

  const output = liveLog ?? run.output;
  return (
    <div className="run-detail">
      {run.note_file && (
        <p>
          <a
            href={`/notes?note=${encodeURIComponent(run.note_file)}`}
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", `/notes?note=${encodeURIComponent(run.note_file!)}`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            View note
          </a>
        </p>
      )}
      {run.error_message && <p className="error">{run.error_message}</p>}
      {run.screenshot_path && (
        <div>
          <p className="hint">Failure screenshot:</p>
          <img className="run-screenshot" src={`/api/runs/${run.id}/screenshot`} alt="Failure screenshot" />
        </div>
      )}
      {run.model_used && (
        <p className="hint">
          Model: {run.model_used}
          {run.monthly_total_tokens_before != null && (
            <>
              {" "}
              &middot; Month-to-date before: {run.monthly_total_tokens_before.toLocaleString()} &rarr; after:{" "}
              {run.monthly_total_tokens_after?.toLocaleString()}
            </>
          )}
        </p>
      )}
      {run.status === "running" && <p className="hint">Live output (refreshes every 3s):</p>}
      {output && <pre className="run-output">{output}</pre>}
    </div>
  );
}
