#!/usr/bin/env node
// Heartbeat to a log file for 10 minutes, then exit.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".kommutator");
mkdirSync(dir, { recursive: true });
const log = join(dir, "spike06.log");
const started = Date.now();
appendFileSync(log, `${new Date().toISOString()} child ${process.pid} started (ppid ${process.ppid})\n`);
const timer = setInterval(() => {
  appendFileSync(log, `${new Date().toISOString()} child ${process.pid} alive (ppid ${process.ppid})\n`);
  if (Date.now() - started > 10 * 60_000) {
    clearInterval(timer);
    appendFileSync(log, `${new Date().toISOString()} child ${process.pid} done\n`);
  }
}, 2000);
