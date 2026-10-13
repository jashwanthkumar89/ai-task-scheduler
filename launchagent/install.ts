#!/usr/bin/env bun
// Installs the LaunchAgent that keeps the scheduler server running: starts it at
// login (RunAtLoad) and restarts it if it ever crashes (KeepAlive).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, "..");
const label = "com.aitaskscheduler.server";
const plistDest = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);

const bunPath = Bun.which("bun");
if (!bunPath) throw new Error("Could not locate the `bun` executable on PATH.");

const pathEnv = [
  dirname(bunPath),
  "/opt/homebrew/bin", // claude
  join(homedir(), ".pyenv", "shims"), // system python3 used by the venv bootstrap
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

mkdirSync(join(projectDir, "server", "data"), { recursive: true });

const template = readFileSync(join(here, `${label}.plist.template`), "utf8");
const plist = template
  .replaceAll("__BUN_PATH__", bunPath)
  .replaceAll("__PROJECT_DIR__", projectDir)
  .replaceAll("__PATH_ENV__", pathEnv)
  .replaceAll("__HOME_DIR__", homedir());

mkdirSync(dirname(plistDest), { recursive: true });
writeFileSync(plistDest, plist);
console.log(`Wrote ${plistDest}`);

Bun.spawnSync(["launchctl", "unload", plistDest], { stdout: "ignore", stderr: "ignore" }); // ignore if not loaded yet
const load = Bun.spawnSync(["launchctl", "load", plistDest], { stdout: "inherit", stderr: "inherit" });
if (load.exitCode !== 0) throw new Error("launchctl load failed");

console.log(`Installed and started ${label}.`);
console.log(`Logs: ${join(projectDir, "server", "data", "launchagent.out.log")}`);
console.log("The server will now start automatically on login and restart itself if it crashes.");
