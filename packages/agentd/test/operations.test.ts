import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConformanceHarness, RemoteRpcError } from "@kommutator/hub/testing";
import { OperationStatus, PROTOCOL_VERSION, Results } from "@kommutator/protocol";
import { DaemonCore, type IpcPeer } from "../src/core.js";
import { OfflineError, RpcError } from "../src/errors.js";
import { OBSERVATION_TTL, RESULT_BYTES } from "../src/operations.js";
import type { HubTransport } from "../src/hub-link.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(path = ":memory:", sharedHub?: ReturnType<typeof createConformanceHarness>) {
  const hub = sharedHub ?? createConformanceHarness();
  if (!sharedHub) cleanup.push(async () => hub.close());
  const hubPeer = hub.connect("host");
  let lose: string | undefined;
  let after: ((method: string) => Promise<void>) | undefined;
  let malformed = false;
  let legacyReceipts = false;
  const calls: Array<{ method: string; params: unknown }> = [];
  const transport: HubTransport & { connected: boolean } = { connected: true, start() {}, async close() { hubPeer.disconnect(); }, async request(method, params) {
    calls.push({ method, params });
    if (!transport.connected) throw new OfflineError();
    let result: unknown;
    try { result = hubPeer.request(method, params); } catch (error) {
      if (error instanceof RemoteRpcError) throw new RpcError(error.code, error.message); throw error;
    }
    if (lose === method) { lose = undefined; transport.connected = false; throw new OfflineError(); }
    await after?.(method);
    if (legacyReceipts && method === "receipt.mark") return { ok: true };
    return malformed && method === "message.send" ? { invalid: true } : result;
  } };
  let now = 100;
  const core = new DaemonCore({ dbPath: path, transport, config: { host: "host", hub: "http://localhost:8787", key: "test-key-sixteen-characters" },
    processStart: async () => "birth", isAlive: async () => true,
    clock: { now: () => now, setTimeout: () => 1, clearTimeout() {} } });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await core.close(); } };
  cleanup.push(close);
  async function shim(root = "root-a", pid = 123): Promise<IpcPeer> {
    const peer = core.peer();
    await core.request(peer, "ipc.hello", { client: "shim", vendor: "codex", vendor_session_id: root, pid, cwd: "/repo", protocol_version: PROTOCOL_VERSION });
    return peer;
  }
  const submit = (peer: IpcPeer, operation_id: string = randomUUID(), to = "all") => core.request(peer, "operation.submit", {
    operation_id, method: "message.send", params: { message: { to: [to], body: "private-body", origin: "agent", force_wake: false } },
  });
  const status = async (peer: IpcPeer, operation_id: string) => OperationStatus.parse(await core.request(peer, "operation.status", { operation_id }));
  return { core, hub, transport, calls, shim, submit, status, close, setTime: (time: number) => { now = time; },
    lose: (method: string) => { lose = method; }, after: (callback: typeof after) => { after = callback; }, malformed: () => { malformed = true; },
    legacyReceipts: () => { legacyReceipts = true; } };
}

it("retains old-hub acknowledgement confirmation without inventing transition counts", async () => {
  const f = await fixture(); const peer = await f.shim(); f.legacyReceipts(); const id = randomUUID();
  expect(await f.core.request(peer, "operation.submit", {
    operation_id: id, method: "receipt.mark", params: { ids: ["unmatched-message"], state: "read" },
  })).toEqual({ ok: true, operation_id: id });
  const status = await f.status(peer, id);
  expect(status).toMatchObject({ outcome: "confirmed", method: "receipt.mark" });
  if (status.outcome !== "confirmed") throw new Error("missing confirmation");
  expect(status.result).toEqual({ ok: true });
  expect(f.core.registry.outbox()).toEqual([]);
});

it("recovers a committed send still queued at restart without changing its replay identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kom-queued-operation-")); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.db"); const first = await fixture(path); const peer = await first.shim(); const id = randomUUID();
  first.lose("message.send"); await first.submit(peer, id);
  const pending = first.core.registry.outbox();
  expect(pending).toHaveLength(1);
  expect(await first.status(peer, id)).toMatchObject({ outcome: "queued" });
  await first.close();
  const restored = await fixture(path, first.hub); restored.transport.connected = false;
  await restored.core.start(); const same = await restored.shim();
  expect(await restored.status(same, id)).toMatchObject({ outcome: "queued" });
  expect(restored.core.registry.outbox().filter(row => row.method === "message.send")).toEqual(pending);
  restored.transport.connected = true; await restored.core.flush();
  expect(await restored.status(same, id)).toMatchObject({ outcome: "confirmed", result: { replayed: true } });
  const original = first.calls.find(call => call.method === "message.send");
  expect(restored.calls.filter(call => call.method === "message.send")).toEqual([original]);
  expect(restored.core.registry.outbox()).toEqual([]);
});

it.each(["birth", "generation", "epoch", "session"] as const)("rejects tracked lookup after the pinned %s changes without disclosing either ID", async changed => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID(); await f.submit(peer, id);
  const record = f.core.registry.get(peer.key ?? ""); if (!record) throw new Error("missing owner");
  if (changed === "birth") record.processStartedAt = "replacement-birth";
  if (changed === "generation") record.ownerGeneration = 1;
  if (changed === "epoch") record.lifecycleEpoch = (record.lifecycleEpoch ?? 0) + 1;
  if (changed === "session") record.session.id = randomUUID();
  f.core.registry.save(record);
  const before = f.calls.length; const outbox = f.core.registry.outbox();
  for (const operationId of [id, randomUUID()]) {
    await expect(f.status(peer, operationId)).rejects.toMatchObject({ code: -32020 });
  }
  expect(f.calls).toHaveLength(before); expect(f.core.registry.outbox()).toEqual(outbox);
});

it("reconciles a committed send with lost acknowledgement using exactly its original replay key", async () => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID();
  f.lose("message.send");
  expect(await f.submit(peer, id)).toMatchObject({ status: "queued", operation_id: id });
  expect(await f.status(peer, id)).toMatchObject({ outcome: "queued" });
  const before = f.calls.length;
  await f.status(peer, id); expect(f.calls).toHaveLength(before);
  f.transport.connected = true; await f.core.flush();
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed", result: { replayed: true } });
  const sends = f.calls.filter(call => call.method === "message.send");
  expect(sends).toHaveLength(2); expect(sends[0]?.params).toEqual(sends[1]?.params);
  expect(f.core.registry.outbox()).toHaveLength(0);
  const journal = JSON.stringify(f.core.registry.db.prepare("SELECT * FROM mutation_observations").all());
  expect(journal).not.toContain("private-body"); expect(journal).not.toContain("test-key");
});

it("records ack counts from the last confirmed attempt after a committed reply is lost", async () => {
  const f = await fixture(); const peer = await f.shim();
  const handle = f.core.registry.get(peer.key ?? "")?.session.handle;
  const sent = Results["send.local"].parse(await f.submit(peer, randomUUID(), handle ?? "missing@host"));
  if (sent.status !== "sent") throw new Error("missing sent result");
  const id = randomUUID(); f.lose("receipt.mark");
  await f.core.request(peer, "operation.submit", { operation_id: id, method: "receipt.mark", params: { ids: [sent.id], state: "read" } });
  f.transport.connected = true; await f.core.flush();
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed", result: { ok: true, counts: { requested: 1, marked_read: 0, already_read: 1 } } });
  const row = f.core.registry.db.prepare("SELECT * FROM mutation_observations WHERE operation_id=?").get(id);
  expect(JSON.stringify(row)).not.toContain(sent.id);
});

it("keeps confirmation query local while a hub response is pending and preserves the final result", async () => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID(); const entered = deferred(), release = deferred();
  f.after(async method => { if (method === "message.send") { entered.resolve(); await release.promise; } });
  const pending = f.submit(peer, id); await entered.promise;
  expect(await f.status(peer, id)).toMatchObject({ outcome: "queued" });
  release.resolve(); expect(await pending).toMatchObject({ status: "sent", operation_id: id });
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed" });
});

it("fences an older Codex connection after same-root process replacement, including a waiting submit", async () => {
  const f = await fixture(); const old = await f.shim(); const entered = deferred(), release = deferred();
  f.after(async method => { if (method === "message.send") { entered.resolve(); await release.promise; } });
  const pending = f.submit(old); const rejected = expect(pending).rejects.toThrow(/owner.*changed/); await entered.promise;
  const replacement = f.shim("root-a", 456);
  for (let i = 0; i < 100 && f.core.registry.get(old.key ?? "")?.pid !== 456; i++) await Promise.resolve();
  expect(f.core.registry.get(old.key ?? "")?.pid).toBe(456);
  release.resolve(); await rejected; const fresh = await replacement;
  const id = randomUUID(); await f.submit(fresh, id);
  await expect(f.status(old, id)).rejects.toThrow(/owner.*changed/);
  expect(await f.status(fresh, id)).toMatchObject({ outcome: "confirmed" });
  await expect(f.submit(old)).rejects.toThrow(/owner.*changed/);
});

it("returns identical unknown observations to another root and to missing IDs", async () => {
  const f = await fixture(); const a = await f.shim(); const b = await f.shim("root-b", 456); const id = randomUUID();
  await f.submit(a, id);
  expect(await f.status(b, id)).toEqual({ operation_id: id, outcome: "unknown" });
  expect(await f.status(b, randomUUID())).toMatchObject({ outcome: "unknown" });
});

it("attaches registration once after offline admission and survives a same-owner daemon restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kom-operations-")); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "state.db"); const f = await fixture(path); f.transport.connected = false;
  const peer = await f.shim(); const id = randomUUID(); await f.submit(peer, id);
  expect(await f.status(peer, id)).toMatchObject({ outcome: "queued" });
  f.transport.connected = true; await f.core.flush();
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed" });
  await f.close(); const restored = await fixture(path, f.hub); await restored.core.start(); const same = await restored.shim();
  expect(await restored.status(same, id)).toMatchObject({ outcome: "confirmed" });
});

it("rejects malformed envelopes, injected authority, duplicate correlation and invalid addresses before enqueue", async () => {
  const f = await fixture(); const peer = await f.shim(); f.transport.connected = false; const id = randomUUID(); await f.submit(peer, id);
  const before = f.core.registry.outbox();
  await expect(f.submit(peer, id)).rejects.toThrow(/already retained/);
  await expect(f.submit(peer, randomUUID(), "bare-topic")).rejects.toThrow(/invalid/);
  await expect(f.submit(peer, "bad-id")).rejects.toThrow(/invalid/);
  await expect(f.core.request(peer, "operation.submit", { operation_id: randomUUID(), method: "receipt.mark", params: { ids: ["x"], state: "read", session_id: "other" } })).rejects.toThrow(/invalid/);
  expect(f.core.registry.outbox()).toEqual(before);
});

it("never confirms or dequeues a malformed successful hub result", async () => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID(); f.malformed();
  expect(await f.submit(peer, id)).toMatchObject({ status: "queued" });
  expect(await f.status(peer, id)).toMatchObject({ outcome: "queued" });
  expect(f.core.registry.outbox()).toHaveLength(1);
});

it("retains safe blocked evidence for hub errors and replay horizon without raw error text", async () => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID();
  await expect(f.submit(peer, id, "missing@host")).rejects.toBeInstanceOf(RpcError);
  expect(await f.status(peer, id)).toMatchObject({ outcome: "blocked", error: { category: "hub-rpc" } });
  const queued = randomUUID(); f.transport.connected = false; await f.submit(peer, queued);
  f.setTime(8 * OBSERVATION_TTL); f.transport.connected = true; await f.core.flush();
  expect(await f.status(peer, queued)).toMatchObject({ outcome: "blocked", error: { category: "replay-horizon" } });
});

it("bounds confirmed retention and reports unknown, never queued, after more than 256 shared-flush completions", async () => {
  const f = await fixture(); const peer = await f.shim(); const first = randomUUID(); const entered = deferred(), release = deferred();
  f.after(async method => { if (method === "message.send") { entered.resolve(); await release.promise; } });
  const initial = f.submit(peer, first); await entered.promise;
  const pending = Array.from({ length: 257 }, () => f.submit(peer));
  for (let i = 0; i < 50; i++) await Promise.resolve();
  release.resolve(); await Promise.all(pending);
  expect(await initial).toEqual({ operation_id: first, outcome: "unknown" });
  expect(await f.status(peer, first)).toEqual({ operation_id: first, outcome: "unknown" });
  expect(f.core.registry.outbox()).toHaveLength(0);
  expect(f.core.registry.db.prepare("SELECT count(*) AS n FROM mutation_observations").get()).toMatchObject({ n: 256 });
});

it("expires confirmation without changing replay authority and requires an extant row for queued", async () => {
  const f = await fixture(); const peer = await f.shim(); const id = randomUUID(); await f.submit(peer, id);
  f.setTime(OBSERVATION_TTL + 100); expect(await f.status(peer, id)).toMatchObject({ outcome: "unknown" });
  f.transport.connected = false; const queued = randomUUID(); await f.submit(peer, queued);
  const row = f.core.registry.outbox()[0]; if (!row) throw new Error("missing queued row");
  f.core.registry.remove(row.id);
  expect(await f.status(peer, queued)).toEqual({ operation_id: queued, outcome: "unknown" });
});

it("compacts oversized send confirmation at the UTF-8 boundary into a typed result", async () => {
  const f = await fixture(); const peer = await f.shim(); f.transport.connected = false;
  const id = randomUUID(); await f.submit(peer, id); const entry = f.core.registry.outbox()[0]; if (!entry) throw new Error("missing entry");
  const result = { id: "message", replayed: false, deliveries: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`session-${i}`, "unread"])) };
  expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(RESULT_BYTES);
  f.core.registry.transaction(() => { f.core.operations.confirm(entry.id, result, 100); f.core.registry.remove(entry.id); });
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed", result: { id: "message", replayed: false, deliveries_omitted: true } });
});

it("rejects new tracked work atomically when unresolved observations fill capacity", async () => {
  const f = await fixture(); const peer = await f.shim(); f.transport.connected = false;
  const retained = randomUUID(); await f.submit(peer, retained);
  const record = f.core.registry.get(peer.key ?? ""); if (!record) throw new Error("missing owner");
  const template = f.core.registry.db.prepare("SELECT owner,session_id FROM mutation_observations").get();
  if (!template) throw new Error("missing template");
  f.core.registry.transaction(() => {
    for (let i = 1; i < 4096; i++) {
      const outbox = f.core.registry.enqueue(record.key, "receipt.mark", { ids: ["retained"], state: "read" }, 100);
      f.core.registry.db.prepare("INSERT INTO mutation_observations VALUES(?,?,?,?,?,?,?,?,NULL,NULL)")
        .run(randomUUID(), String(template.owner), typeof template.session_id === "string" ? template.session_id : null, "receipt.mark", outbox, 100, 100, "queued");
    }
  });
  const before = f.core.registry.outbox().length;
  await expect(f.submit(peer)).rejects.toThrow(/capacity/);
  expect(f.core.registry.outbox()).toHaveLength(before);
  expect(await f.status(peer, retained)).toMatchObject({ outcome: "queued" });
});

it("rolls back admission and settlement together when persistence fails", async () => {
  const f = await fixture(); const peer = await f.shim(); f.transport.connected = false;
  f.core.registry.db.exec("CREATE TRIGGER reject_observation BEFORE INSERT ON mutation_observations BEGIN SELECT RAISE(ABORT, 'injected persistence error'); END");
  await expect(f.submit(peer)).rejects.toThrow(/injected persistence/);
  expect(f.core.registry.outbox()).toHaveLength(0);
  f.core.registry.db.exec("DROP TRIGGER reject_observation");
  const id = randomUUID(); await f.submit(peer, id);
  f.core.registry.db.exec("CREATE TRIGGER reject_dequeue BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT, 'injected settlement error'); END");
  f.transport.connected = true; await f.core.flush();
  expect(await f.status(peer, id)).toMatchObject({ outcome: "queued" });
  expect(f.core.registry.outbox()).toHaveLength(1);
  f.core.registry.db.exec("DROP TRIGGER reject_dequeue"); await f.core.flush();
  expect(await f.status(peer, id)).toMatchObject({ outcome: "confirmed", result: { replayed: true } });
});

it("preserves the exact 65536-byte result and compacts one byte beyond it", async () => {
  const f = await fixture(); const peer = await f.shim(); f.transport.connected = false;
  const deliveries: Record<string, "unread"> = {};
  let result = { id: "x", replayed: false, deliveries };
  let size = Buffer.byteLength(JSON.stringify(result));
  // Each extra delivery costs key length + 12 bytes, except the first comma.
  while (size + 76 < RESULT_BYTES) {
    const key = `session-${Object.keys(deliveries).length}`.padEnd(64, "x"); deliveries[key] = "unread";
    size = Buffer.byteLength(JSON.stringify(result));
  }
  const remaining = RESULT_BYTES - size;
  if (remaining >= 13) deliveries["z".repeat(remaining - 12)] = "unread";
  else result = { ...result, id: "x".repeat(remaining + 1) };
  expect(Buffer.byteLength(JSON.stringify(result))).toBe(RESULT_BYTES);
  for (const extra of [false, true]) {
    const id = randomUUID(); await f.submit(peer, id); const entry = f.core.registry.outbox().at(-1); if (!entry) throw new Error("missing entry");
    const value = { ...result, id: result.id + (extra ? "x" : "") };
    f.core.registry.transaction(() => { f.core.operations.confirm(entry.id, value, 100); f.core.registry.remove(entry.id); });
    const status = await f.status(peer, id);
    expect(status).toMatchObject({ outcome: "confirmed" });
    if (status.outcome !== "confirmed") throw new Error("missing confirmation");
    expect("deliveries_omitted" in status.result).toBe(extra);
    expect(Buffer.byteLength(JSON.stringify(status.result))).toBeLessThanOrEqual(RESULT_BYTES);
  }
});

it("pins before hello's flush and never enables tracking for an incomplete or replaced hello", async () => {
  const f = await fixture(); const entered = deferred(), release = deferred();
  f.after(async method => { if (method === "session.upsert") { entered.resolve(); await release.promise; } });
  const old = f.core.peer();
  const hello = f.core.request(old, "ipc.hello", { client: "shim", vendor: "codex", vendor_session_id: "same-root", pid: 123, cwd: "/repo", protocol_version: PROTOCOL_VERSION });
  await entered.promise;
  await expect(f.status(old, randomUUID())).rejects.toThrow(/owner.*unavailable/);
  const next = f.shim("same-root", 456);
  for (let i = 0; i < 100 && f.core.registry.get(old.key ?? "")?.pid !== 456; i++) await Promise.resolve();
  expect(f.core.registry.get(old.key ?? "")?.pid).toBe(456);
  release.resolve(); await hello; const fresh = await next;
  await expect(f.submit(old)).rejects.toThrow(/owner.*unavailable/);
  expect(await f.submit(fresh)).toMatchObject({ status: "sent" });
});

it("answers strict CLI runtime compatibility without reconciliation, flush or owner mutation", async () => {
  const f = await fixture(); const shim = await f.shim();
  f.transport.connected = false; await f.submit(shim); f.transport.connected = true;
  const before = f.core.registry.outbox(); const calls = f.calls.length;
  const cli = f.core.peer(); await f.core.request(cli, "ipc.hello", { client: "cli", pid: 456, cwd: "/repo", protocol_version: PROTOCOL_VERSION });
  expect(await f.core.request(cli, "daemon.runtime", {})).toMatchObject({ runtime_contract: 3, daemon: { version: expect.any(String) } });
  await expect(f.core.request(cli, "daemon.runtime", { caller: "other" })).rejects.toThrow(/invalid/);
  await expect(f.core.request(shim, "daemon.runtime", {})).rejects.toThrow(/CLI/);
  expect(f.calls).toHaveLength(calls); expect(f.core.registry.outbox()).toEqual(before);
});
