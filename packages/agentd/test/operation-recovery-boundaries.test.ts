import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConformanceHarness, RemoteRpcError } from "@kommutator/hub/testing";
import { OperationStatus, PROTOCOL_VERSION, RUNTIME_CONTRACT } from "@kommutator/protocol";
import { DaemonCore, type IpcPeer } from "../src/core.js";
import { OfflineError, RpcError } from "../src/errors.js";
import type { HubTransport } from "../src/hub-link.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kom-operation-boundaries-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const hub = createConformanceHarness(); cleanup.push(async () => hub.close());
  const calls: string[] = [];
  let after: ((method: string) => Promise<void>) | undefined;
  function start() {
    const remote = hub.connect("host");
    const transport: HubTransport & { connected: boolean } = {
      connected: true, start() {}, async close() { remote.disconnect(); },
      async request(method, params) {
        calls.push(method);
        if (!transport.connected) throw new OfflineError();
        let result: unknown;
        try { result = remote.request(method, params); }
        catch (error) { if (error instanceof RemoteRpcError) throw new RpcError(error.code, error.message); throw error; }
        await after?.(method);
        return result;
      },
    };
    const core = new DaemonCore({ dbPath: join(home, "state.db"), transport,
      config: { host: "host", hub: "http://localhost:8787", key: "fixture-only-secret-key" },
      processStart: async () => "birth", isAlive: async () => true,
      clock: { now: () => 100, setTimeout: () => 1, clearTimeout() {} } });
    let closed = false;
    const close = async () => { if (!closed) { closed = true; await core.close(); } };
    cleanup.push(close);
    async function claude(generation: number, endpoint?: string, cwd = "/repo") {
      const facts = { vendor: "claude-code", vendor_session_id: "conversation", pid: 322, ppid: 321,
        runtime_contract: RUNTIME_CONTRACT, owner_generation: generation, cwd,
        protocol_version: PROTOCOL_VERSION, ...(endpoint ? { endpoint } : {}) };
      const hook = core.peer(); await core.request(hook, "ipc.hello", { ...facts, client: "hook" });
      const peer = core.peer(); await core.request(peer, "ipc.hello", { ...facts, client: "shim" });
      return peer;
    }
    const submit = (peer: IpcPeer, id: string, to = "all") => core.request(peer, "operation.submit", {
      operation_id: id, method: "message.send", params: { message: { to: [to], body: "fixture", origin: "agent", force_wake: false } },
    });
    const status = async (peer: IpcPeer, id: string) => OperationStatus.parse(await core.request(peer, "operation.status", { operation_id: id }));
    return { core, claude, submit, status, close };
  }
  return { home, start, calls, after: (callback: typeof after) => { after = callback; } };
}

it("retains blocked observation evidence through refresh without retrying the rejected command", async () => {
  const f = await fixture(), runtime = f.start(), old = await runtime.claude(1), id = randomUUID();
  expect(await runtime.submit(old, id, "missing@host")).toMatchObject({ outcome: "blocked", error: { code: -32004, reason: "recipient-not-found" } });
  const blocked = await runtime.status(old, id), outbox = runtime.core.registry.outbox(), count = f.calls.length;
  expect(blocked).toMatchObject({ outcome: "blocked", error: { category: "hub-rpc", code: -32004 } });
  const fresh = await runtime.claude(2);
  expect(await runtime.status(fresh, id)).toEqual(blocked);
  expect(runtime.core.registry.outbox()).toEqual(outbox);
  expect(f.calls.slice(count)).not.toContain("message.send");
});

it("does not inherit observations when an endpoint changes and rejects changed project context", async () => {
  const f = await fixture(), runtime = f.start(), old = await runtime.claude(1, "/fixture/old.sock"), id = randomUUID();
  await runtime.submit(old, id);
  await expect(runtime.claude(2, "/fixture/old.sock", "/another-project")).rejects.toMatchObject({ code: -32020 });
  expect(await runtime.status(old, id)).toMatchObject({ outcome: "confirmed" });
  const fresh = await runtime.claude(2, "/fixture/new.sock");
  expect(await runtime.status(fresh, id)).toEqual({ operation_id: id, outcome: "unknown" });
});

it("does not transfer observations across a durable SessionEnd marker even when IPC end was lost", async () => {
  const f = await fixture(), runtime = f.start(), old = await runtime.claude(1), id = randomUUID();
  await runtime.submit(old, id);
  const owner = createHash("sha256").update(`claude-active:${JSON.stringify([321, "birth"])}`).digest("hex");
  const journal = join(f.home, "contexts", `${owner}.json.d`);
  await mkdir(journal, { recursive: true }); await writeFile(join(journal, "1.ended"), "");
  const fresh = await runtime.claude(2);
  expect(await runtime.status(fresh, id)).toEqual({ operation_id: id, outcome: "unknown" });
  expect(f.calls.filter(method => method === "session.gone")).toHaveLength(1);
});

it("persists transferred observations through a daemon restart without re-sending", async () => {
  const f = await fixture(), first = f.start(), old = await first.claude(1), id = randomUUID();
  await first.submit(old, id); const current = await first.claude(2), expected = await first.status(current, id);
  await first.close(); const second = f.start(); await second.core.start();
  const rebound = await second.claude(2);
  expect(await second.status(rebound, id)).toEqual(expected);
  expect(f.calls.filter(method => method === "message.send")).toHaveLength(1);
});

it("returns an acknowledgement's committed counts while a later send remains pending", async () => {
  const f = await fixture(), runtime = f.start(), peer = await runtime.claude(1), id = randomUUID();
  const ackEntered = deferred(), releaseAck = deferred(), sendEntered = deferred(), releaseSend = deferred();
  f.after(async method => {
    if (method === "receipt.mark") { ackEntered.resolve(); await releaseAck.promise; }
    if (method === "message.send") { sendEntered.resolve(); await releaseSend.promise; }
  });
  const ack = runtime.core.request(peer, "operation.submit", {
    operation_id: id, method: "receipt.mark", params: { ids: ["missing-message"], state: "read" },
  });
  await ackEntered.promise;
  const send = runtime.submit(peer, randomUUID()); releaseAck.resolve(); await sendEntered.promise;
  try {
    const result = await Promise.race([ack, new Promise(resolve => setTimeout(() => resolve("still waiting"), 100))]);
    expect(result).toMatchObject({ ok: true, operation_id: id, counts: { requested: 1, matched: 0, unmatched: 1 } });
    expect(await runtime.status(peer, id)).toMatchObject({ outcome: "confirmed", method: "receipt.mark" });
  } finally { releaseSend.resolve(); await Promise.all([ack, send]); }
});
