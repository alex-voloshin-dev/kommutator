import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createConformanceHarness } from "@kommutator/hub/testing";
import { startDaemon, type HubTransport } from "@kommutator/agentd";
import { OperationStatus, PROTOCOL_VERSION, RegisteredSession, Results } from "@kommutator/protocol";
import * as z from "zod";
import { IpcClient } from "../src/ipc-client.js";

it("reconciles send and ack after the real IPC client times out without resubmitting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-operation-ipc-"));
  const hub = createConformanceHarness(); const remote = hub.connect("host");
  let delay: string | undefined; let release: (() => void) | undefined;
  let pending: Promise<void> | undefined;
  const calls: string[] = [];
  const transport: HubTransport = { connected: true, start() {}, async close() { remote.disconnect(); }, async request(method, params) {
    calls.push(method); const result = remote.request(method, params);
    if (method === delay) { pending = new Promise<void>(resolve => { release = resolve; }); await pending; }
    return result;
  } };
  const daemon = await startDaemon({ home: directory, config: { host: "host", hub: "http://localhost:8787", key: "fixture-test-key-long" }, transport, processStart: async () => "birth", isAlive: async () => true });
  const core = daemon.core;
  const client = new IpcClient({ endpoint: daemon.paths.ipc, timeoutMs: 100, retries: 0, hello: () => ({ client: "shim", vendor: "codex", vendor_session_id: "root", pid: 123, cwd: "/repo", protocol_version: PROTOCOL_VERSION, runtime_contract: 4 }) });
  try {
    const identity = z.object({ session: RegisteredSession }).parse(await client.call("whoami"));
    const sendId = randomUUID(); delay = "message.send";
    await expect(client.call("operation.submit", { operation_id: sendId, method: "message.send", params: { message: { to: [identity.session.handle], body: "one stored message", origin: "agent", force_wake: false } } })).rejects.toThrow(/timed out/);
    expect(OperationStatus.parse(await client.call("operation.status", { operation_id: sendId }))).toMatchObject({ outcome: "queued" });
    delay = undefined; release?.(); await core.flush();
    const sent = OperationStatus.parse(await client.call("operation.status", { operation_id: sendId }));
    expect(sent).toMatchObject({ outcome: "confirmed", result: { replayed: false } });
    if (sent.outcome !== "confirmed" || sent.method !== "message.send") throw new Error("missing send confirmation");
    const ackId = randomUUID(); delay = "receipt.mark";
    await expect(client.call("operation.submit", { operation_id: ackId, method: "receipt.mark", params: { ids: [sent.result.id], state: "read" } })).rejects.toThrow(/timed out/);
    expect(OperationStatus.parse(await client.call("operation.status", { operation_id: ackId }))).toMatchObject({ outcome: "queued" });
    delay = undefined; release?.(); await core.flush();
    expect(OperationStatus.parse(await client.call("operation.status", { operation_id: ackId }))).toMatchObject({ outcome: "confirmed", result: { counts: { marked_read: 1, already_read: 0 } } });
    expect(calls.filter(method => method === "message.send")).toHaveLength(1);
    expect(calls.filter(method => method === "receipt.mark")).toHaveLength(1);
    expect(Results.status.parse(remote.request("status", {})).messages).toBe(1);
  } finally {
    release?.(); await core.flush(); client.close(); await daemon.close(); hub.close(); await rm(directory, { recursive: true, force: true });
  }
});

it("prepares a fresh bound Claude hello after late hook registration before sending or acknowledging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-late-tracked-"));
  const hub = createConformanceHarness(); const remote = hub.connect("host");
  const transport: HubTransport = { connected: true, start() {}, async close() { remote.disconnect(); }, async request(method, params) { return remote.request(method, params); } };
  const daemon = await startDaemon({ home: directory, config: { host: "host", hub: "http://localhost:8787", key: "fixture-test-key-long" }, transport, processStart: async () => "birth", isAlive: async () => true });
  const clients: IpcClient[] = [];
  try {
    for (const [index, method] of ["message.send", "receipt.mark"].entries()) {
      const id = `late-${index}`; const pid = 123 + index;
      const client = new IpcClient({ endpoint: daemon.paths.ipc, timeoutMs: 500, retries: 0,
        hello: () => ({ client: "shim", vendor: "claude-code", vendor_session_id: id, pid: 1000 + index, ppid: pid, cwd: "/repo", protocol_version: PROTOCOL_VERSION, runtime_contract: 4 }) }); clients.push(client);
      await expect(client.call("whoami")).rejects.toThrow(/binding|owner|session/i);
      const hook = daemon.core.peer();
      await daemon.core.request(hook, "ipc.hello", { client: "hook", vendor: "claude-code", vendor_session_id: id, pid: 2000 + index, ppid: pid, cwd: "/repo", protocol_version: PROTOCOL_VERSION, runtime_contract: 4 });
      await client.call("whoami"); // Existing legacy path binds, but cannot mutate its original immutable snapshot.
      const operation_id = randomUUID();
      const params = method === "message.send" ? { message: { to: ["all"], body: "late owner", origin: "agent", force_wake: false } } : { ids: ["unknown-message"], state: "read" };
      expect(await client.call("operation.submit", { operation_id, method, params })).toMatchObject({ operation_id });
      expect(OperationStatus.parse(await client.call("operation.status", { operation_id }))).toMatchObject({ outcome: "confirmed" });
      expect(daemon.core.registry.all().filter(record => record.session.vendor_session_id === id)).toHaveLength(1);
    }
  } finally { for (const client of clients) client.close(); await daemon.close(); hub.close(); await rm(directory, { recursive: true, force: true }); }
});
