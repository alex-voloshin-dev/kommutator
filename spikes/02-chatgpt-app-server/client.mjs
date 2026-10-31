#!/usr/bin/env node
// Minimal Codex app-server client for spike 02.
//
//   node client.mjs list                               # threads (uses $SOCK or --socket)
//   node client.mjs start --thread thr_x --text "…"    # wake a thread with a new turn
//   node client.mjs steer --thread thr_x --turn turn_y --text "…"
//   node client.mjs --stdio list                       # fallback: spawn `codex app-server`
//
// Unix-socket transport = WebSocket over an HTTP upgrade (ws+unix://). stdio = JSONL.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--stdio") flags.stdio = true;
  else if (a.startsWith("--")) flags[a.slice(2)] = argv[++i];
  else positional.push(a);
}
const cmd = positional[0] ?? "list";
const socketPath = flags.socket ?? process.env.SOCK;
if (!flags.stdio && !socketPath) {
  console.error("set $SOCK or pass --socket, or use --stdio");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Transport: both expose send(line) and an onLine(cb) hook.

async function openTransport() {
  if (flags.stdio) {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
    const rl = createInterface({ input: child.stdout });
    const listeners = [];
    rl.on("line", (l) => listeners.forEach((cb) => cb(l)));
    return {
      send: (line) => child.stdin.write(line + "\n"),
      onLine: (cb) => listeners.push(cb),
      close: () => child.kill(),
    };
  }
  const { default: WebSocket } = await import("ws");
  // ws expects ws+unix://<socket path>:<request path>
  const url = `ws+unix://${socketPath}:/`;
  const headers = flags.token ? { Authorization: `Bearer ${flags.token}` } : {};
  const ws = new WebSocket(url, { headers });
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  const listeners = [];
  ws.on("message", (d) => listeners.forEach((cb) => cb(d.toString())));
  return {
    send: (line) => ws.send(line),
    onLine: (cb) => listeners.push(cb),
    close: () => ws.close(),
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing.

const t = await openTransport();
let nextId = 1;
const pending = new Map();
// Every parsed notification goes here, in order, so a command can inspect events that
// arrived before its own response was processed (e.g. a turn that completes instantly).
const notifications = [];
const notificationWaiters = [];
t.onLine((line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.log("⟵ (non-JSON)", line.slice(0, 200));
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    console.log("⟵ notification", msg.method, JSON.stringify(msg.params ?? {}).slice(0, 300));
    notifications.push(msg);
    for (const w of notificationWaiters.splice(0)) w(msg);
  } else {
    console.log("⟵", line.slice(0, 300));
  }
});

/** Resolve when a notification matching `pred` exists (buffered or future); undefined on timeout. */
function waitForNotification(pred, timeoutMs) {
  const hit = notifications.find(pred);
  if (hit) return Promise.resolve(hit);
  return new Promise((res) => {
    const timer = setTimeout(() => res(undefined), timeoutMs);
    const check = (msg) => {
      if (pred(msg)) {
        clearTimeout(timer);
        res(msg);
      } else {
        notificationWaiters.push(check);
      }
    };
    notificationWaiters.push(check);
  });
}

/**
 * True only when a notification names BOTH the expected thread and the expected turn.
 * An event that omits either id is not evidence about our turn (R08): it is logged by the
 * generic notification printer but never accepted as the terminal event.
 */
function belongsTo(params, threadId, turnId) {
  const p = params ?? {};
  const tid = p.threadId ?? p.thread_id ?? p.turn?.threadId ?? p.thread?.id;
  const uid = p.turnId ?? p.turn_id ?? p.turn?.id;
  return tid !== undefined && uid !== undefined && tid === threadId && uid === turnId;
}

function call(method, params = {}) {
  const id = nextId++;
  const line = JSON.stringify({ method, id, params });
  console.log("⟶", line.slice(0, 300));
  return new Promise((res, rej) => {
    pending.set(id, (msg) => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
    t.send(line);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`timeout waiting for ${method}`));
      }
    }, 20_000);
  });
}
function notify(method, params = {}) {
  const line = JSON.stringify({ method, params });
  console.log("⟶", line);
  t.send(line);
}

// ---------------------------------------------------------------------------
// Commands.

try {
  const init = await call("initialize", {
    clientInfo: { name: "kommutator-spike02", title: "kommutator spike 02", version: "0.0.0" },
  });
  console.log("initialized:", JSON.stringify(init).slice(0, 300));
  notify("initialized", {});

  if (cmd === "list") {
    const r = await call("thread/list", { cursor: null, limit: 50, sortKey: "created_at" });
    for (const th of r.data ?? []) {
      console.log(`${th.id}  ${String(th.status?.type ?? "").padEnd(10)}  ${th.name ?? ""}  — ${(th.preview ?? "").slice(0, 60)}`);
    }
    t.close();
    process.exit(0);
  }

  if (cmd === "start") {
    if (!flags.thread) throw new Error("--thread required");
    const r = await call("turn/start", {
      threadId: flags.thread,
      input: [{ type: "text", text: flags.text ?? "Say 'pong' and nothing else." }],
    });
    console.log("turn:", JSON.stringify(r));
    const turnId = r?.turn?.id;
    if (!turnId) {
      console.error("turn/start returned no turn id — not counting this as a wake");
      t.close();
      process.exit(2);
    }
    // Wait for *this* turn's terminal event; events of other threads/turns are ignored.
    const done = await waitForNotification(
      (m) => /^turn\/(completed|failed|error|cancelled)$/.test(m.method) && belongsTo(m.params, flags.thread, turnId),
      60_000,
    );
    t.close();
    if (!done) {
      console.error(`TIMEOUT: no terminal event for turn ${turnId} within 60 s (request was accepted, outcome unknown)`);
      process.exit(3);
    }
    // Positive criterion only (T03): the terminal event must be turn/completed AND the turn
    // status must be exactly "completed". The app-server reference lists "failed" and
    // "interrupted" as non-success statuses; a missing or unknown status is not a pass either.
    const status = done.params?.turn?.status;
    if (done.method === "turn/completed" && status === "completed") {
      console.log(`PASS: turn ${turnId} on thread ${flags.thread} completed`);
      process.exit(0);
    }
    console.error(`FAILED: turn ${turnId} ended with ${done.method}, status=${status === undefined ? "(missing)" : JSON.stringify(status)}`);
    process.exit(2);
  }

  if (cmd === "steer") {
    if (!flags.thread || !flags.turn) throw new Error("--thread and --turn required");
    const r = await call("turn/steer", {
      threadId: flags.thread,
      input: [{ type: "text", text: flags.text ?? "Also mention the current time." }],
      expectedTurnId: flags.turn,
    });
    console.log("steer:", JSON.stringify(r));
    t.close();
    process.exit(0);
  }

  console.error(`unknown command ${cmd}`);
  process.exit(1);
} catch (e) {
  console.error("error:", e.message);
  t.close();
  process.exit(2);
}
