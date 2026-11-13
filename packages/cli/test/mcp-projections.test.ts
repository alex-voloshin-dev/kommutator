import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { statusHealthDetails } from "../src/mcp-projections.js";
import { createMcpServer } from "../src/mcp.js";

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const callback of close.splice(0)) await callback(); });

async function setup(result: unknown) {
  const calls: { method: string; params: Record<string, unknown> | undefined }[] = [];
  const server = createMcpServer({ close() {}, async call(method, params) {
    calls.push({ method, params });
    return result;
  } });
  const client = new Client({ name: "claude-code", version: "test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close.push(() => client.close(), () => server.close());
  async function call(name: string, args: Record<string, unknown> = {}) {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    const content = response.content;
    if (!Array.isArray(content) || content[0]?.type !== "text") throw new Error("Expected MCP text result");
    return JSON.parse(content[0].text as string) as unknown;
  }
  return { client, call, calls };
}

it("summarizes large status lists while retaining caller failure, health and last error", async () => {
  const result = {
    runtime_contract: 3, daemon: { version: "test" }, hub: { connected: false },
    caller: { state: "gone", recovery: "Run the current hook", session_id: "caller" },
    health: { state: "degraded", issues: ["Hub disconnected"] }, last_error: "Connection reset", last_error_at: 123,
    hook_observations: [{ outcome: "attempted" }], outbox_depth: 2,
    sessions: [{ id: "active", state: "active", cwd: "/private" }, ...Array.from({ length: 123 }, (_, n) => ({ id: `old-${n}`, state: "gone" }))],
    outbox: [{ id: "pending", age_ms: 5 }, { id: "blocked", age_ms: 10, error: "Denied" }],
  };
  const { call, calls } = await setup(result);
  const { sessions: _sessions, outbox: _outbox, ...retained } = result;
  expect(await call("status")).toEqual({ ...retained, health_details: expect.any(Object),
    session_counts: { total: 124, by_state: { active: 1, gone: 123 } },
    outbox_summary: { total: 2, blocked: 1, oldest_age_ms: 10 },
  });
  expect(await call("status", { detailed: true })).toEqual(statusHealthDetails(result));
  expect(calls).toEqual(Array.from({ length: 2 }, () => ({ method: "daemon.status", params: {} })));
  expect(result.sessions).toHaveLength(124);
});

it("returns a small board acknowledgement and preserves version and replay evidence", async () => {
  const result = { entry: { topic: "feedback", key: "roster", body: "x".repeat(9000), version: 3, updated_at: "now", author: "peer@host", protected: false }, replayed: true };
  const { call, calls } = await setup(result);
  const args = { topic: "feedback", key: "roster", body: result.entry.body, if_version: 2 };
  const { body: _body, ...metadata } = result.entry;
  expect(await call("board_put", args)).toEqual({ entry: metadata, replayed: true });
  expect(await call("board_put", { ...args, include_body: true })).toEqual(result);
  expect(calls).toEqual(Array.from({ length: 2 }, () => ({ method: "board.put", params: args })));
  expect(result.entry.body).toHaveLength(9000);
});

it("supports compact session identity without removing requested filtering", async () => {
  const session = { id: "hub-id", handle: "peer@host", vendor_session_id: "conversation", vendor: "claude-code", host: "host", role: "developer", state: "idle", status_line: "Reviewing", cwd: "/project", incarnation: 5 };
  const { call, calls } = await setup({ sessions: [session] });
  const { cwd: _cwd, incarnation: _incarnation, ...compact } = session;
  expect(await call("list_sessions", { compact: true, state: "gone", topic: "feedback" })).toEqual({ sessions: [compact] });
  expect(await call("list_sessions")).toEqual({ sessions: [session] });
  expect(calls).toEqual([
    { method: "session.list", params: { state: "gone", topic: "feedback" } },
    { method: "session.list", params: {} },
  ]);
});

it("omits inbox previews without changing cursor, unread state, full IDs or receipts", async () => {
  const header = { id: "14406c99-2d69-4a3f-b852-154edd029840", thread_id: "thread", seq: 123, from: "peer@host", preview: "Long preview", state: "unread", wake: true, subject: "Report" };
  const result = { headers: [header], cursor: 123, more: true };
  const { call, calls, client } = await setup(result);
  const { preview: _preview, ...compact } = header;
  expect(await call("inbox", { preview: false, since_seq: 122, unread_only: false, limit: 10 })).toEqual({ ...result, headers: [compact] });
  expect(await call("inbox", { since_seq: 122, unread_only: false, limit: 10 })).toEqual(result);
  expect(calls).toEqual(Array.from({ length: 2 }, () => ({ method: "inbox.list", params: { since_seq: 122, unread_only: false, limit: 10 } })));
  expect((await client.listTools()).tools.find(tool => tool.name === "inbox")?.description).toContain("ignores since_seq");
});

it("rejects malformed projection controls before any RPC", async () => {
  const { client, calls } = await setup({});
  for (const [name, args] of [
    ["status", { detailed: "yes" }], ["list_sessions", { compact: 1 }],
    ["inbox", { preview: "false" }], ["board_put", { topic: "feedback", key: "roster", body: "body", include_body: "yes" }],
  ] as const) expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
  expect(calls).toEqual([]);
});

it("keeps unavailable-daemon diagnostics and empty queue counts without changing the original response", async () => {
  const empty = Object.freeze({
    daemon: Object.freeze({ running: true }),
    sessions: Object.freeze([]), outbox: Object.freeze([]), outbox_depth: 0,
    caller: Object.freeze({ state: "unavailable", recovery: "Resume with trusted hooks" }),
  });
  const { call } = await setup(empty);
  expect(await call("status")).toEqual({
    daemon: { running: true }, outbox_depth: 0, health_details: expect.any(Object),
    caller: { state: "unavailable", recovery: "Resume with trusted hooks" },
    session_counts: { total: 0, by_state: {} },
    outbox_summary: { total: 0, blocked: 0, oldest_age_ms: 0 },
  });
  expect(await call("status", { detailed: true })).toEqual(statusHealthDetails(empty));
  const unavailable = Object.freeze({ daemon: Object.freeze({ running: false }), last_error: "ECONNREFUSED" });
  const stopped = await setup(unavailable);
  expect(await stopped.call("status")).toEqual(statusHealthDetails(unavailable));
});

it("projects connected active evidence without hiding old blocked work or mutating frozen input", async () => {
  const outbox = Object.freeze(Array.from({ length: 7 }, (_, i) => Object.freeze({
    id: i + 1, method: "message.send", age_ms: 1000 * i, error: "private error", body: "secret", idempotency_key: "secret",
  })));
  const source = Object.freeze({ hub: Object.freeze({ connected: true }), caller: Object.freeze({ state: "active", recovery: "keep" }),
    health: Object.freeze({ state: "degraded", issues: Object.freeze(["Blocked outbox"]) }), outbox, last_error_at: 123 });
  const { call, calls } = await setup(source);
  for (const detailed of [false, true]) {
    const result = await call("status", { detailed });
    expect(result).toMatchObject({ health: source.health, caller: source.caller, health_details: {
      connectivity: "connected", caller: "active", last_error_at: 123, last_error_evidence: "historical",
      backlog: { total: 7, blocked: 7, oldest_age_ms: 6000, oldest_blocked_age_ms: 6000, omitted: 2,
        warning: expect.stringContaining("remains unresolved"), examples: [6, 5, 4, 3, 2].map(i => ({ id: i + 1, method: "message.send", age_ms: 1000 * i })) },
    } });
    const details = (result as { health_details: unknown }).health_details;
    expect(JSON.stringify(details)).not.toContain("secret"); expect(JSON.stringify(details)).not.toContain("private error");
  }
  expect(calls.map(c => c.method)).toEqual(["daemon.status", "daemon.status"]);
  expect(statusHealthDetails(source)).toEqual(statusHealthDetails(source));
  expect(source.outbox).toBe(outbox);
});

it("keeps missing old-daemon evidence unknown and reports empty ages as unavailable", () => {
  expect(statusHealthDetails({})).toMatchObject({ health_details: { connectivity: "unknown", caller: "unverified",
    backlog: { total: null, blocked: null, oldest_age_ms: null, oldest_blocked_age_ms: null, examples: [], omitted: 0 }, last_error_at: null } });
  expect(statusHealthDetails({ hub: { connected: false }, caller: { state: "conflict" }, outbox: [] })).toMatchObject({
    health_details: { connectivity: "disconnected", caller: "conflict", backlog: { total: 0, blocked: 0, oldest_age_ms: null, warning: null } },
  });
});
