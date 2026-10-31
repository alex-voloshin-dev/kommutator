#!/usr/bin/env node
// Run after pnpm install --frozen-lockfile and pnpm -r build. Uses TCP only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "packages", "cli", "dist", "index.js");
const key = randomBytes(32).toString("hex");
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("Smoke exceeded 45 seconds")), 45_000);
const children = new Set();
const sockets = new Set();
const checks = [];
let directory;
let stage = "setup";
let result;

const interrupt = () => controller.abort(new Error("Smoke interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const signalFor = (ms) => AbortSignal.any([controller.signal, AbortSignal.timeout(ms)]);

function startCli(args, database, port) {
  controller.signal.throwIfAborted();
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    env: { ...process.env, KOM_KEY: key, KOM_HUB_DB: database, KOM_HUB_BIND: "127.0.0.1", KOM_HUB_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const state = { child, output: "", ended: false, error: undefined, done: undefined };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { state.output = (state.output + chunk.toString()).slice(-8_000); });
  }
  child.once("error", (error) => { state.error = error; });
  state.done = new Promise((resolve) => child.once("close", (code, signal) => {
    state.ended = true;
    resolve({ code, signal });
  }));
  children.add(state);
  return state;
}

async function waitFor(test, label, timeout = 8_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    controller.signal.throwIfAborted();
    const value = await test();
    if (value) return value;
    await delay(40, undefined, { signal: controller.signal });
  }
  throw new Error(`${label} timed out`);
}

async function stopChild(state) {
  if (!state.ended) state.child.kill("SIGTERM");
  const exited = await Promise.race([state.done.then(() => true), delay(2_000, false)]);
  if (!exited) {
    state.child.kill("SIGKILL");
    assert(await Promise.race([state.done.then(() => true), delay(2_000, false)]), "Child did not stop");
  }
  children.delete(state);
}

async function unusedPort() {
  const server = createServer();
  try {
    const listening = once(server, "listening", { signal: signalFor(3_000) });
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    assert(address && typeof address === "object", "Missing TCP address");
    return address.port;
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(base, path, authorization = `Bearer ${key}`) {
  const response = await fetch(`${base}${path}`, {
    headers: authorization ? { authorization } : {},
    signal: signalFor(2_000),
  });
  return { status: response.status, type: response.headers.get("content-type"), body: await response.text() };
}

async function snapshot(base) {
  const response = await request(base, "/api/snapshot");
  assert.equal(response.status, 200, "Snapshot HTTP status");
  const data = JSON.parse(response.body);
  assert(data && typeof data === "object" && !Array.isArray(data), "Invalid snapshot");
  for (const field of ["hosts", "sessions", "deliveries"]) assert(Array.isArray(data[field]), `Invalid snapshot ${field}`);
  return data;
}

async function startHub(database, port) {
  const state = startCli(["hub", "run"], database, port);
  // Observe this child's listening log before probing; a port-allocation race must fail.
  await waitFor(() => {
    if (state.error) throw state.error;
    if (state.ended) throw new Error("Hub exited before listening");
    return state.output.includes(`kom hub listening on 127.0.0.1:${port}`);
  }, "Hub startup");
  return state;
}

async function connect(WebSocket, protocol, base, host) {
  const socket = new WebSocket(base.replace("http:", "ws:"), { headers: { authorization: `Bearer ${key}` } });
  sockets.add(socket);
  const pending = new Map();
  const deliveries = [];
  let failure;
  let nextId = 0;
  const fail = (error) => {
    failure = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error(`WebSocket closed for ${host}`)));
  socket.on("message", (bytes) => {
    try {
      const frame = JSON.parse(bytes.toString());
      assert(frame && typeof frame === "object" && frame.jsonrpc === "2.0", "Invalid RPC envelope");
      if (frame.method === "deliver") {
        deliveries.push(protocol.Notifications.deliver.parse(frame.params));
      } else if (frame.method === "config") {
        protocol.Notifications.config.parse(frame.params);
      } else {
        const entry = pending.get(frame.id);
        assert(entry, "Unexpected RPC response");
        pending.delete(frame.id);
        if (frame.error) entry.reject(new Error(`${entry.method} RPC error: ${JSON.stringify(frame.error)}`));
        else entry.resolve(protocol.Results[entry.method].parse(frame.result));
      }
    } catch (error) { fail(error); }
  });
  await once(socket, "open", { signal: signalFor(5_000) });
  const call = async (method, params) => {
    controller.signal.throwIfAborted();
    if (failure) throw failure;
    const id = ++nextId;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${method} RPC timed out`)), 5_000);
        pending.set(id, { method, resolve, reject });
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }), (error) => { if (error) reject(error); });
      });
    } finally { clearTimeout(timer); pending.delete(id); }
  };
  const hello = await call("hello", { host, agentd_version: "hub-smoke", protocol_version: protocol.PROTOCOL_VERSION });
  assert.equal(hello.host, host);
  return {
    call,
    delivery: (messageId) => waitFor(() => {
      if (failure) throw failure;
      return deliveries.find((delivery) => delivery.message.id === messageId);
    }, "Delivery notification"),
  };
}

function verifyPersisted(data, sender, recipient, messageId) {
  assert.equal(data.hosts.length, 2, "Persisted hosts");
  assert.deepEqual(data.sessions.map((session) => session.id).sort(), [sender.id, recipient.id].sort(), "Persisted sessions");
  assert.equal(data.deliveries.length, 1, "Persisted delivery count");
  const delivery = data.deliveries[0];
  assert.equal(delivery.id, messageId);
  assert.equal(delivery.session_id, recipient.id);
  assert.equal(delivery.sender, sender.handle);
  assert.equal(delivery.state, "read", "Persisted marked-read receipt");
}

try {
  assert.equal(process.versions.node.split(".")[0], "24", "Use Node 24, as declared in .nvmrc");
  await access(cli);
  const requireHub = createRequire(join(root, "packages", "hub", "package.json"));
  const WebSocket = requireHub("ws");
  const protocol = await import(new URL("../packages/protocol/dist/index.js", import.meta.url));
  directory = await mkdtemp(join(tmpdir(), "kom hub smoke "));
  const database = join(directory, "hub database.sqlite");
  const backup = join(directory, "hub backup.sqlite");
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;

  stage = "http";
  let hub = await startHub(database, port);
  for (const path of ["/", "/api/snapshot"]) assert.equal((await request(base, path, "")).status, 401, `Unauthenticated ${path}`);
  const page = await request(base, "/", `Basic ${Buffer.from(`smoke:${key}`).toString("base64")}`);
  assert.equal(page.status, 200, "Dashboard HTTP status");
  assert.match(page.type ?? "", /text\/html/);
  assert.match(page.body, /kommutator/i);
  const empty = await snapshot(base);
  assert.equal(empty.protocol_version, protocol.PROTOCOL_VERSION);
  assert.equal(empty.sessions.length, 0);
  checks.push("http_auth", "dashboard", "snapshot");

  stage = "websocket";
  const a = await connect(WebSocket, protocol, base, "smoke-a");
  const b = await connect(WebSocket, protocol, base, "smoke-b");
  const register = async (client, host) => (await client.call("session.upsert", {
    op: "register", reg_id: randomUUID(),
    session: { host, name: "smoke", vendor: "other", project_key: "hub-smoke", cwd: directory },
  })).session;
  const sender = await register(a, "smoke-a");
  const recipient = await register(b, "smoke-b");
  assert.notEqual(sender.id, recipient.id);
  const body = "Cross-host hub smoke: Unicode ✓ and a path with spaces.";
  const sent = await a.call("message.send", {
    session_id: sender.id, idempotency_key: randomUUID(),
    message: { from: sender.handle, to: [recipient.handle], kind: "dm", body },
  });
  assert.equal(sent.deliveries[recipient.id], "unread");
  const delivered = await b.delivery(sent.id);
  assert.equal(delivered.session_id, recipient.id);
  assert.equal(delivered.message.from, sender.handle);
  assert.equal(delivered.message.body, body);
  assert.equal(delivered.seq, 1);
  assert.equal((await snapshot(base)).deliveries[0]?.state, "unread", "Delivery alone must not mark read");
  const read = await b.call("message.read", { session_id: recipient.id, id: sent.id });
  assert.equal(read.message.body, body);
  assert.equal(read.state, "read");
  verifyPersisted(await snapshot(base), sender, recipient, sent.id);
  checks.push("two_host_registration", "send_deliver", "marked_read");

  stage = "backup";
  const backupProcess = startCli(["hub", "backup", backup], database, port);
  await waitFor(() => backupProcess.ended, "Online backup");
  assert.equal((await backupProcess.done).code, 0, "Backup exit code");
  assert((await stat(backup)).size > 0, "Backup file is empty");
  checks.push("online_backup");

  for (const socket of sockets) socket.terminate();
  stage = "restart";
  await stopChild(hub);
  hub = await startHub(database, port);
  verifyPersisted(await snapshot(base), sender, recipient, sent.id);
  checks.push("restart_persistence");
  await stopChild(hub);
  stage = "backup_restore";
  hub = await startHub(backup, port);
  verifyPersisted(await snapshot(base), sender, recipient, sent.id);
  checks.push("backup_restore");
  result = { ok: true, platform: process.platform, node: process.versions.node, checks };
} catch (error) {
  result = { ok: false, platform: process.platform, node: process.versions.node, stage, checks,
    error: error instanceof Error ? error.message : String(error),
    diagnostics: [...children].map((state) => state.output).filter(Boolean).join("\n").slice(-8_000) };
} finally {
  clearTimeout(deadline);
  for (const socket of sockets) socket.terminate();
  const cleanup = await Promise.allSettled([...children].map(stopChild));
  const failures = cleanup.filter((entry) => entry.status === "rejected").map((entry) => String(entry.reason));
  try { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (error) { failures.push(String(error)); }
  if (failures.length) result = { ...result, ok: false, cleanup_errors: failures };
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}

// Child diagnostics are useful on failure, but even unexpected output must not expose the key.
console.log(JSON.stringify(result).replaceAll(key, "[redacted]"));
process.exitCode = result.ok ? 0 : 1;
