# AI Task Scheduler

A local, single-user task scheduler for:
- **Work tasks**: run Claude Code (`claude -p`) headlessly on a schedule, with a model picker, timeout, and an interactive macOS approval dialog for anything beyond `acceptEdits`.
- **Personal tasks**: run a Python/Selenium script on a schedule (e.g. download a bill and upload it for reimbursement), or a plain reminder/checklist you mark done by hand.

Everything lives behind one web UI at `http://localhost:4273`, split into Work and Personal sections in the sidebar, plus a token usage dashboard and settings.

## How it's built

- `server/` - Bun + Hono API and scheduler. SQLite (`bun:sqlite`) stores tasks, run history, and token usage logs in `server/data/scheduler.sqlite`.
- `web/` - React (Vite) single-page app. In production the server serves `web/dist` directly, so the whole app is one process on one port.
- `scripts/python/` - the shared Python venv (bootstrapped lazily on first script-task run) and an example Selenium script template.
- `scripts/secrets/` - per-task `.env` files with credentials for Selenium scripts. **Gitignored, never commit real values.**
- `launchagent/` - the macOS LaunchAgent that keeps the server running (auto-start on login, auto-restart on crash).

## Running it

```bash
bun install

# Development: API with hot reload + Vite dev server with HMR
bun run dev:server   # http://localhost:4273 (API)
bun run dev:web      # http://localhost:5273 (UI, proxies /api to the server)

# Production-style: one process, one port
bun run build:web
bun run start         # http://localhost:4273 serves both the API and the built UI
```

### Installing the LaunchAgent (auto-start on login)

```bash
bun run install-launchagent
```

This builds the web UI, writes `~/Library/LaunchAgents/com.aitaskscheduler.server.plist`, and loads it via `launchctl`. The server will then start automatically at login and restart itself if it crashes. Logs go to `server/data/launchagent.out.log` / `.err.log`.

To remove it:

```bash
bun run uninstall-launchagent
```

## Task types

- **Claude (work)**: a prompt (can invoke a skill inline, e.g. `/skill-name ...`) run via `claude -p --model <model> --permission-mode acceptEdits` from the default working directory set in Settings. Anything needing permission beyond `acceptEdits` triggers a native macOS Allow/Deny dialog (via an MCP `--permission-prompt-tool`, see `server/src/mcp/permission-server.ts`); unanswered dialogs auto-deny after ~2 minutes so a run can't stall forever. Each run also has a configurable timeout as a safety net.
- **Script (personal)**: runs `scripts/venv/bin/python3 <script_path> <args>` with `SECRETS_FILE` and `FAILURE_SCREENSHOT_PATH` env vars set so your script can load credentials and save a screenshot on failure. See `scripts/python/examples/sample_bill_task.py` for the expected conventions.
- **Reminder (personal)**: fires a notification on schedule and shows up as a pending run in the UI; click "Mark done" once you've handled it by hand. No script execution.

## Token usage

Every Claude task run captures its own token usage from `claude -p --output-format json`, plus a before/after snapshot of your month-to-date total tokens (parsed from Claude Code's own local session logs under `~/.claude/projects/**/*.jsonl`). The Token Usage tab shows month-to-date totals, per-task totals, and recent runs.

## Secrets

Never commit real credentials. Copy `scripts/secrets/sample_bill_task.env.example` to a real `.env` file outside git tracking (the whole `scripts/secrets/` directory is gitignored) and point a script task's "secrets file" field at it.
