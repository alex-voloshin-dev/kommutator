#!/usr/bin/env node
// Spawn child.mjs exactly the way agentd will be lazy-started, then exit immediately.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(homedir(), ".kommutator");
mkdirSync(dir, { recursive: true });

const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "child.mjs")], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
child.unref();
writeFileSync(join(dir, "spike06.pid"), String(child.pid));
console.log(`spawned detached child pid=${child.pid}; parent pid=${process.pid} exiting now`);
