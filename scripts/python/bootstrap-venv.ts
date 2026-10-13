#!/usr/bin/env bun
// Creates (if needed) and installs dependencies into the shared Python venv used by
// Selenium/script tasks. Invoked lazily by the server's scriptRunner, or manually via
// `bun run scripts/python/bootstrap-venv.ts`.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const venvDir = join(here, "..", "venv");
const requirements = join(here, "requirements.txt");

if (!existsSync(join(venvDir, "bin", "python3"))) {
  console.log(`Creating Python venv at ${venvDir}`);
  const create = Bun.spawnSync(["python3", "-m", "venv", venvDir], { stdout: "inherit", stderr: "inherit" });
  if (create.exitCode !== 0) throw new Error("Failed to create venv");
}

const pip = join(venvDir, "bin", "pip");
Bun.spawnSync([pip, "install", "--upgrade", "pip"], { stdout: "ignore", stderr: "inherit" });
const install = Bun.spawnSync([pip, "install", "-r", requirements], { stdout: "inherit", stderr: "inherit" });
if (install.exitCode !== 0) throw new Error("Failed to install requirements");

console.log(`Venv ready: ${venvDir}`);
