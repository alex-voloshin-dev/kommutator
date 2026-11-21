import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DaemonCore, OfflineError, RpcError, type HubTransport } from "@kommutator/agentd";
import { createConformanceHarness, RemoteRpcError } from "@kommutator/hub/testing";
import { OperationId, OperationStatus } from "@kommutator/protocol";
import { ClaudePluginClient } from "../src/claude.js";
import { createMcpServer } from "../src/mcp.js";
import { IpcError, type Hello, type RpcClient } from "../src/ipc-client.js";
import type { ActiveClaudeRegistration } from "../src/plugin-context.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const observed = (): ActiveClaudeRegistration => ({ birth: "fixture-birth", generation: "fixture-birth:1", hello: {
  client: "hook", vendor: "claude-code", vendor_session_id: "offline-conversation", protocol_version: 1,
  runtime_contract: 4, pid: 456, ppid: 123, cwd: "/offline-fixture", owner_generation: 1,
} });
function resultText(result: { content?: unknown }): string {
  if (!Array.isArray(result.content) || typeof result.content[0]?.text !== "string") throw new Error("missing MCP text");
  return result.content[0].text;
}

async function fixture() {
  const hub = createConformanceHarness();
  cleanup.push(async () => hub.close());
  const hubPeer = hub.connect("fixture-host");
  const requests: string[] = [];
  const transport: HubTransport & { connected: boolean } = { connected: true, start() {}, async close() { hubPeer.disconnect(); },
    async request(method, params) {
      requests.push(method);
      if (!transport.connected) throw new OfflineError();
      try { return hubPeer.request(method, params); }
      catch (error) { if (error instanceof RemoteRpcError) throw new RpcError(error.code, error.message); throw error; }
    },
  };
  const core = new DaemonCore({ dbPath: ":memory:", transport,
    config: { host: "fixture-host", hub: "http://localhost:8787", key: "offline-fixture-private-key" },
    processStart: async () => "fixture-birth", isAlive: async () => true,
    clock: { now: () => 100, setTimeout: () => 1, clearTimeout() {} },
  });
  cleanup.push(() => core.close());
  const registration = observed();
  const hook = core.peer();
  await core.request(hook, "ipc.hello", registration.hello);
  const calls: string[] = [];
  const rpc = (hello: Hello): RpcClient => {
    const peer = core.peer();
    let ready: Promise<unknown> | undefined;
    return { close() { core.disconnect(peer); }, async call(method, params = {}) {
      calls.push(method);
      try {
        ready ??= core.request(peer, "ipc.hello", hello);
        await ready;
        return await core.request(peer, method, params);
      } catch (error) {
        if (error instanceof RpcError) throw new IpcError(error.message, error.code);
        if (error instanceof OfflineError) throw new IpcError("hub unavailable", -32030);
        throw error;
      }
    } };
  };
  const claude = new ClaudePluginClient({ resolve: async () => registration, prepare: async () => {},
    shim: hello => rpc({ ...hello, client: "shim", pid: 789 }), hook: rpc });
  cleanup.push(async () => claude.close());
  const server = createMcpServer(claude);
  const client = new Client({ name: "claude-code", version: "offline-fixture" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  cleanup.push(() => server.close(), () => client.close());
  return { core, transport, requests, calls, client, hook, registration };
}

it.each(["send", "ack"])("admits Claude MCP %s offline and later settles the original operation", async name => {
  const f = await fixture();
  f.transport.connected = false;
  const before = f.requests.length;
  const result = await f.client.callTool({ name, arguments: name === "send" ? { to: "all", body: "offline once" } : { ids: ["missing-message"] } });
  expect(result.isError).not.toBe(true);
  const queued = JSON.parse(resultText(result));
  expect(queued).toMatchObject({ status: "queued" });
  const id = OperationId.parse(queued.operation_id);
  expect(f.requests).toHaveLength(before);
  const rows = f.core.registry.outbox();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.method).toBe(name === "send" ? "message.send" : "receipt.mark");
  const lookup = await f.client.callTool({ name: "operation_status", arguments: { operation_id: id } });
  expect(OperationStatus.parse(JSON.parse(resultText(lookup)))).toMatchObject({ operation_id: id, outcome: "queued" });
  expect(f.core.registry.outbox()).toEqual(rows);
  f.transport.connected = true;
  await f.core.flush();
  const confirmed = await f.client.callTool({ name: "operation_status", arguments: { operation_id: id } });
  expect(OperationStatus.parse(JSON.parse(resultText(confirmed)))).toMatchObject({ operation_id: id, outcome: "confirmed" });
  expect(f.calls.filter(method => method === "operation.submit")).toHaveLength(1);
  expect(f.requests.filter(method => method === rows[0]?.method)).toHaveLength(1);
  expect(f.core.registry.outbox()).toEqual([]);
});

it.each([-32601, -32602, -32030, undefined])("does not submit or recover when local preflight fails with %s", async code => {
  const calls: string[] = [];
  const failure = new IpcError("preflight failed", code);
  const claude = new ClaudePluginClient({ resolve: async () => observed(), prepare: async () => {},
    shim: () => ({ close() {}, async call(method) { calls.push(method); throw failure; } }),
    hook() { throw new Error("must not recover a non-authority error"); },
  });
  await expect(claude.call("operation.submit", { operation_id: "invalid-id" })).rejects.toBe(failure);
  expect(calls).toEqual(["operation.status"]);
  claude.close();
});

it("rejects a malformed operation UUID before admission through the real daemon", async () => {
  const f = await fixture();
  // Bypass MCP's UUID creation to exercise the wrapper/daemon boundary directly.
  const registration = observed();
  const peer = f.core.peer();
  await f.core.request(peer, "ipc.hello", { ...registration.hello, client: "shim", pid: 789 });
  const calls: string[] = [];
  const claude = new ClaudePluginClient({ resolve: async () => registration, prepare: async () => {},
    shim: () => ({ close() {}, async call(method, params = {}) { calls.push(method); return f.core.request(peer, method, params); } }),
    hook() { throw new Error("must not recover malformed UUID"); },
  });
  f.transport.connected = false;
  await expect(claude.call("operation.submit", { operation_id: "invalid-id" })).rejects.toMatchObject({ code: -32602 });
  expect(calls).toEqual(["operation.status"]);
  expect(f.core.registry.outbox()).toEqual([]);
  claude.close();
});

it.each(["preflight", "recovery", "submit"])("fences a conversation switch during tracked %s without replay", async phase => {
  let registration = observed();
  let shims = 0;
  const calls: string[] = [];
  const change = () => { registration = { ...registration, generation: "fixture-birth:2" }; };
  const claude = new ClaudePluginClient({ resolve: async () => registration, prepare: async () => {},
    shim() {
      const index = ++shims;
      return { close() {}, async call(method) {
        calls.push(`shim:${index}:${method}`);
        if (phase === "preflight" && method === "operation.status") change();
        if (phase === "recovery" && index === 1) throw new IpcError("retired", -32020);
        if (phase === "submit" && method === "operation.submit") change();
        return {};
      } };
    },
    hook: () => ({ close() {}, async call(method) { calls.push(`hook:${method}`); change(); return {}; } }),
  });
  await expect(claude.call("operation.submit", { operation_id: "51a11daa-1c88-4225-b8cf-39b3ba6893b6" })).rejects.toThrow("conversation changed");
  expect(calls.filter(method => method.endsWith(":operation.submit"))).toHaveLength(phase === "submit" ? 1 : 0);
  claude.close();
});

it("opens a fresh shim after preflight authority recovery but never retries a rejected submit", async () => {
  const calls: string[] = [];
  let shims = 0;
  const ambiguous = new IpcError("owner changed after admission", -32020);
  const claude = new ClaudePluginClient({ resolve: async () => observed(), prepare: async () => {},
    shim() {
      const index = ++shims;
      return { close() {}, async call(method) {
        calls.push(`shim:${index}:${method}`);
        if (index === 1) throw new IpcError("retired", -32020);
        throw ambiguous;
      } };
    },
    hook: () => ({ close() {}, async call(method) { calls.push(`hook:${method}`); return {}; } }),
  });
  await expect(claude.call("operation.submit", { operation_id: "51a11daa-1c88-4225-b8cf-39b3ba6893b6" })).rejects.toBe(ambiguous);
  expect(calls).toEqual(["shim:1:operation.status", "hook:whoami", "shim:2:operation.submit"]);
  claude.close();
});


it.each([
  { transition: "retired", name: "send" },
  { transition: "retired", name: "ack" },
  { transition: "superseded", name: "send" },
  { transition: "superseded", name: "ack" },
])("rejects offline $name from a $transition owner without admission", async ({ transition, name }) => {
  const f = await fixture();
  // Pin the shim while this owner is valid, then change authority in the real daemon.
  const identity = await f.client.callTool({ name: "whoami", arguments: {} });
  expect(identity.isError).not.toBe(true);
  if (transition === "retired") {
    await f.core.request(f.hook, "session.gone");
    await f.core.flush();
  } else {
    await f.core.request(f.core.peer(), "ipc.hello", { ...f.registration.hello, owner_generation: 2 });
  }
  f.transport.connected = false;
  const callCount = f.calls.length;
  const result = await f.client.callTool({ name, arguments: name === "send" ? { to: "all", body: "must not admit" } : { ids: ["missing-message"] } });
  expect(result.isError).toBe(true);
  expect(JSON.parse(resultText(result))).toMatchObject({ outcome: "unknown" });
  expect(f.calls.slice(callCount)).not.toContain("operation.submit");
  expect(f.core.registry.outbox().filter(row => row.method === "message.send" || row.method === "receipt.mark")).toEqual([]);
  expect(f.core.registry.db.prepare("SELECT COUNT(*) AS count FROM mutation_observations").get()).toEqual({ count: 0 });
});
