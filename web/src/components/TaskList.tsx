import { useEffect, useState } from "react";
import { api, type Category, type Task } from "../api";
import { TaskForm, formValueToPayload } from "./TaskForm";
import { RunHistory } from "./RunHistory";

export function TaskList({ category }: { category: Category }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      setTasks(await api.listTasks(category));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 10_000);
    return () => clearInterval(interval);
  }, [category]);

  async function toggleEnabled(task: Task) {
    await api.updateTask(task.id, { enabled: !task.enabled });
    load();
  }

  async function runNow(task: Task) {
    await api.runTaskNow(task.id);
    setOpenId(task.id);
    setRefreshKey((k) => k + 1);
    setTimeout(load, 1500);
  }

  async function remove(task: Task) {
    if (!confirm(`Delete "${task.name}"? This also deletes its run history.`)) return;
    await api.deleteTask(task.id);
    load();
  }

  return (
    <div className="task-list">
      <div className="task-list-header">
        <h2>{category === "work" ? "Work" : "Personal"}</h2>
        <button onClick={() => setCreating(true)}>+ New task</button>
      </div>

      {creating && (
        <div className="panel">
          <TaskForm
            category={category}
            onCancel={() => setCreating(false)}
            onSubmit={async (value) => {
              await api.createTask(formValueToPayload(value));
              setCreating(false);
              load();
            }}
          />
        </div>
      )}

      {loading && <p className="hint">Loading tasks...</p>}
      {!loading && tasks.length === 0 && !creating && (
        <p className="hint">No {category} tasks yet. Create one to get started.</p>
      )}

      {tasks.map((task) => (
        <div className="task-card" key={task.id}>
          {editingId === task.id ? (
            <div className="panel">
              <TaskForm
                category={category}
                initial={task}
                onCancel={() => setEditingId(null)}
                onSubmit={async (value) => {
                  await api.updateTask(task.id, formValueToPayload(value));
                  setEditingId(null);
                  load();
                }}
              />
            </div>
          ) : (
            <>
              <div className="task-card-header">
                <label className="switch">
                  <input type="checkbox" checked={task.enabled} onChange={() => toggleEnabled(task)} />
                  <span className="slider" />
                </label>
                <div className="task-meta" onClick={() => setOpenId(openId === task.id ? null : task.id)}>
                  <strong>{task.name}</strong>
                  <span className="hint">
                    {task.kind} &middot; {task.schedule_description}
                    {task.running && <span className="badge badge-running">Running</span>}
                  </span>
                </div>
                <div className="task-actions">
                  <button className="secondary small" onClick={() => runNow(task)} disabled={task.running}>
                    Run now
                  </button>
                  <button className="secondary small" onClick={() => setEditingId(task.id)}>
                    Edit
                  </button>
                  <button className="secondary small danger" onClick={() => remove(task)}>
                    Delete
                  </button>
                </div>
              </div>
              {openId === task.id && (
                <div className="task-history">
                  <RunHistory taskId={task.id} refreshKey={refreshKey} />
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
