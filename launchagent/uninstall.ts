#!/usr/bin/env bun
// Stops and removes the LaunchAgent installed by install.ts.
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const label = "com.aitaskscheduler.server";
const plistDest = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);

if (existsSync(plistDest)) {
  Bun.spawnSync(["launchctl", "unload", plistDest], { stdout: "inherit", stderr: "inherit" });
  rmSync(plistDest);
  console.log(`Removed ${plistDest}`);
} else {
  console.log("LaunchAgent was not installed.");
}
