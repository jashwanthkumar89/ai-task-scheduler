import { useEffect, useState } from "react";
import { TaskList } from "./components/TaskList";
import { UsageDashboard } from "./components/UsageDashboard";
import { SettingsPage } from "./components/SettingsPage";

type View = "work" | "personal" | "usage" | "settings";

const PATHS: Record<View, string> = {
  work: "/",
  personal: "/personal",
  usage: "/usage",
  settings: "/settings",
};

function viewFromPath(pathname: string): View {
  for (const [view, path] of Object.entries(PATHS) as [View, string][]) {
    if (path === pathname) return view;
  }
  return "work";
}

export default function App() {
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));

  const go = (v: View) => {
    window.history.pushState({}, "", PATHS[v]);
    setView(v);
  };

  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app">
      <nav className="sidebar">
        <h1>AI Task Scheduler</h1>
        <button className={view === "work" ? "nav-item active" : "nav-item"} onClick={() => go("work")}>
          Work
        </button>
        <button
          className={view === "personal" ? "nav-item active" : "nav-item"}
          onClick={() => go("personal")}
        >
          Personal
        </button>
        <div className="nav-divider" />
        <button className={view === "usage" ? "nav-item active" : "nav-item"} onClick={() => go("usage")}>
          Token usage
        </button>
        <button
          className={view === "settings" ? "nav-item active" : "nav-item"}
          onClick={() => go("settings")}
        >
          Settings
        </button>
      </nav>
      <main className="content">
        {view === "work" && <TaskList category="work" />}
        {view === "personal" && <TaskList category="personal" />}
        {view === "usage" && <UsageDashboard />}
        {view === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
