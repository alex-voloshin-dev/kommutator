#!/usr/bin/env node
// Spike 01, binding question: what does a stdio MCP server spawned by Claude Code see in its
// environment that identifies the session? Register this file as a temporary MCP server
// (see README), open TWO sessions in the same folder, and compare the log with each
// session's hook `session_id`.
//
// Behaves as a minimal MCP server (answers `initialize` so Claude Code is happy) and logs
// every CLAUDE_* variable name — values only for the ones that look like ids (no tokens).

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const dir = join(homedir(), ".kommutator");
mkdirSync(dir, { recursive: true });
const log = join(dir, "spike01-mcp-env.log");

const names = Object.keys(process.env).filter((k) => /^(CLAUDE|MCP|ANTHROPIC)_/i.test(k)).sort();
const shown = {};
for (const k of names) {
  // Print values only for id-like variables; never for anything that could be a secret.
  shown[k] = /SESSION_ID|PROJECT_DIR|PLUGIN_ROOT|ENTRYPOINT|CODE_SSE_PORT/i.test(k) && !/TOKEN|KEY|SECRET/i.test(k) ? process.env[k] : "(set)";
}
appendFileSync(
  log,
  `${new Date().toISOString()} pid=${process.pid} ppid=${process.ppid} cwd=${process.cwd()} env=${JSON.stringify(shown)}\n`,
);

// Minimal MCP stdio server: respond to initialize and tools/list, ignore the rest.
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return;
  let result;
  if (msg.method === "initialize") {
    result = {
      protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "kommutator-spike01-env-probe", version: "0.0.0" },
    };
    appendFileSync(log, `${new Date().toISOString()} pid=${process.pid} initialize clientInfo=${JSON.stringify(msg.params?.clientInfo ?? null)}\n`);
  } else if (msg.method === "tools/list") {
    result = { tools: [] };
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "probe" } }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
});
