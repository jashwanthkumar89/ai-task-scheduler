import { useEffect, useState } from "react";
import { api } from "../api";

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);

  if (!settings) return <p className="hint">Loading settings...</p>;

  async function save() {
    await api.updateSettings(settings!);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <label>
        Default working directory for work (Claude) tasks
        <input
          value={settings.default_working_dir}
          onChange={(e) => setSettings({ ...settings, default_working_dir: e.target.value })}
        />
      </label>

      <label>
        Notifications
        <select
          value={settings.notify_on}
          onChange={(e) => setSettings({ ...settings, notify_on: e.target.value })}
        >
          <option value="every_run">Every run (success and failure)</option>
          <option value="failures_only">Failures only</option>
          <option value="none">None</option>
        </select>
      </label>

      <button onClick={save}>Save settings</button>
      {saved && <span className="hint"> Saved.</span>}
    </div>
  );
}
