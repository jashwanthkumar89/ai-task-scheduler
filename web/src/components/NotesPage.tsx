import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { api } from "../api";

interface NoteMeta {
  file: string;
  date: string;
  time: string | null;
  title: string;
}

export function NotesPage() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listNotes().then(setNotes).catch((e) => setError(e.message));
  }, []);

  // Deep link: /notes?note=<file> opens that note directly (e.g. from run history).
  useEffect(() => {
    const file = new URLSearchParams(window.location.search).get("note");
    if (file) open(file);
  }, [notes]);

  const byDateTime = useMemo(() => {
    const group = (items: NoteMeta[]) => {
      const groups = new Map<string, NoteMeta[]>();
      for (const n of items) {
        const key = n.time ? `${n.date} ${n.time}` : n.date;
        const list = groups.get(key) ?? [];
        list.push(n);
        groups.set(key, list);
      }
      return [...groups.entries()];
    };
    return {
      reviews: group(notes.filter((n) => n.file.includes("pr-review"))),
      tasks: group(notes.filter((n) => !n.file.includes("pr-review"))),
    };
  }, [notes]);

  const renderGroup = ([group, items]: [string, NoteMeta[]]) => (
    <div key={group} className="note-group">
      <div className="note-date">{group}</div>
      {items.map((n) => (
        <button
          key={n.file}
          className={selected === n.file ? "note-item active" : "note-item"}
          onClick={() => open(n.file)}
        >
          {n.title}
        </button>
      ))}
    </div>
  );

  const open = async (file: string) => {
    setSelected(file);
    setEditing(false);
    setSaved(false);
    try {
      const n = await api.getNote(file);
      setContent(n.content);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const save = async () => {
    if (!selected) return;
    await api.saveNote(selected, content);
    setSaved(true);
    setEditing(false);
  };

  return (
    <div className="notes-page">
      <div className="notes-list">
        <h2>Notes</h2>
        {byDateTime.tasks.length > 0 && (
          <>
            <div className="note-section">Task notes</div>
            {byDateTime.tasks.map(renderGroup)}
          </>
        )}
        {byDateTime.reviews.length > 0 && (
          <>
            <div className="note-section">PR reviews</div>
            {byDateTime.reviews.map(renderGroup)}
          </>
        )}
        {notes.length === 0 && !error && <p className="hint">No notes yet.</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="note-view">
        {selected ? (
          <>
            <div className="note-actions">
              <button className="secondary" onClick={() => setEditing((e) => !e)}>
                {editing ? "Cancel" : "Edit"}
              </button>
              {editing && <button onClick={save}>Save</button>}
              {saved && <span className="hint">Saved</span>}
            </div>
            {editing ? (
              <textarea
                className="note-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            ) : (
              <div
                className="note-content markdown"
                dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }}
              />
            )}
          </>
        ) : (
          <p className="hint">Select a note.</p>
        )}
      </div>
    </div>
  );
}
