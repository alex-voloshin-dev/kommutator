import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { OperationId } from "@kommutator/protocol";
import { createMcpServer } from "../src/mcp.js";
import { IpcError, type RpcClient } from "../src/ipc-client.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(source: RpcClient | (() => Promise<RpcClient>)) {
  const server = createMcpServer(source); const client = new Client({ name: "test", version: "test" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  cleanup.push(() => server.close(), () => client.close()); return client;
}
function text(result: { content?: unknown }): string {
  const content = result.content;
  if (!Array.isArray(content) || !content[0] || typeof content[0].text !== "string") throw new Error("missing tool text");
  return content[0].text;
}
it.each(["send", "ack"])("correlates %s timeout and never automatically resubmits", async name => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const client = await fixture({ close() {}, async call(method, params) { calls.push({ method, ...(params ? { params } : {}) }); throw new IpcError("IPC timed out"); } });
  const result = await client.callTool({ name, arguments: name === "send" ? { to: "all", body: "test" } : { ids: ["message"] } });
  expect(result.isError).toBe(true);
  const body = JSON.parse(text(result)); expect(OperationId.safeParse(body.operation_id).success).toBe(true);
  expect(body).toMatchObject({ outcome: "unknown", guidance: expect.stringContaining("operation_status") });
  expect(body.guidance).toContain("setup_status"); expect(body.guidance).toContain("whoami");
  expect(calls).toEqual([{ method: "operation.submit", params: expect.objectContaining({ operation_id: body.operation_id }) }]);
});
it("generates correlation before client resolution and omits it on input validation errors", async () => {
  let calls = 0;
  const client = await fixture(async () => { calls++; throw new Error("private-identity-fixture"); });
  const valid = await client.callTool({ name: "send", arguments: { to: "all", body: "test" } });
  expect(JSON.parse(text(valid))).toMatchObject({ operation_id: expect.any(String), outcome: "unknown", guidance: expect.stringContaining("setup_status and whoami") });
  expect(text(valid)).not.toContain("private-identity-fixture");
  const invalid = await client.callTool({ name: "send", arguments: { to: [], body: "test" } });
  expect(text(invalid)).not.toContain("operation_id"); expect(calls).toBe(1);
});
it("reports old-daemon upgrade requirements without falling back to a legacy mutation", async () => {
  const calls: string[] = [];
  const client = await fixture({ close() {}, async call(method) { calls.push(method); throw new IpcError("unknown method", -32601); } });
  const result = await client.callTool({ name: "send", arguments: { to: "all", body: "test" } });
  expect(JSON.parse(text(result))).toMatchObject({ error: "local-daemon-upgrade-required", outcome: "unknown" });
  expect(calls).toEqual(["operation.submit"]);
});
it("adds a distinct correlation to successful invocations and routes lookup through the bound client", async () => {
  const ids: string[] = [];
  const client = await fixture({ close() {}, async call(method, params) {
    if (method === "operation.submit") { ids.push(OperationId.parse(params?.operation_id)); return { ok: true }; }
    expect(method).toBe("operation.status"); return { operation_id: params?.operation_id, outcome: "unknown" };
  } });
  for (let i = 0; i < 2; i++) {
    const result = await client.callTool({ name: "ack", arguments: { ids: ["message"] } });
    expect(JSON.parse(text(result))).toEqual({ ok: true, operation_id: ids[i] });
  }
  expect(new Set(ids).size).toBe(2);
  expect(JSON.parse(text(await client.callTool({ name: "operation_status", arguments: { operation_id: ids[0] } })))).toEqual({ operation_id: ids[0], outcome: "unknown" });
});

it("classifies incompatible preparation before dispatch without exposing arbitrary diagnostic text", async () => {
  let preparations = 0;
  const client = await fixture(async () => {
    preparations++;
    throw new IpcError("private-fixture-detail-that-must-not-leak", -32601);
  });
  const result = await client.callTool({ name: "send", arguments: { to: "all", body: "never dispatched" } });
  expect(result.isError).toBe(true);
  expect(JSON.parse(text(result))).toMatchObject({ error: "local-daemon-upgrade-required", outcome: "unknown", operation_id: expect.any(String) });
  expect(text(result)).not.toContain("private-fixture-detail");
  expect(preparations).toBe(1);
});

it("keeps trusted directional compatibility recovery through a tracked MCP error", async () => {
  const { RuntimeCompatibilityError } = await import("../src/plugin-daemon.js");
  const client = await fixture(async () => { throw new RuntimeCompatibilityError("The client is older. Do not restart the shared daemon."); });
  const result = await client.callTool({ name: "send", arguments: { to: "all", body: "test" } });
  expect(JSON.parse(text(result))).toMatchObject({ error: "runtime-incompatible", guidance: expect.stringContaining("Do not restart the shared daemon") });
});


it.each(["send", "ack", "operation_status"])("reports a durable blocked %s result with safe guidance and no retry", async name => {
  const calls: string[] = [];
  const knownId = "05160c0e-a715-4a65-a3b4-5995d960b905";
  const client = await fixture({ close() {}, async call(method, params) {
    calls.push(method);
    return { operation_id: params?.operation_id, outcome: "blocked", method: name === "ack" ? "receipt.mark" : "message.send",
      created_at: 1, observed_at: 2, error: { category: "hub-rpc", code: -32001, reason: "topic-membership-required" } };
  } });
  const result = await client.callTool({ name, arguments: name === "send" ? { to: "topic:unjoined", body: "test" }
    : name === "ack" ? { ids: ["message"] } : { operation_id: knownId } });
  expect(result.isError).toBe(name === "operation_status" ? undefined : true);
  expect(JSON.parse(text(result))).toMatchObject({ outcome: "blocked", error: { reason: "topic-membership-required" },
    guidance: expect.stringContaining("does not prove earlier attempts did not commit") });
  expect(calls).toEqual([name === "operation_status" ? "operation.status" : "operation.submit"]);
});

it.each(["unknown-reason", "extra-field", "wrong-id"])("does not reflect a malformed blocked observation (%s)", async fault => {
  const client = await fixture({ close() {}, async call(_method, params) {
    return { operation_id: fault === "wrong-id" ? "05160c0e-a715-4a65-a3b4-5995d960b905" : params?.operation_id,
      outcome: "blocked", method: "message.send", created_at: 1, observed_at: 2,
      error: { category: "hub-rpc", code: -32001,
        ...(fault === "unknown-reason" ? { reason: "private-server-detail" } : {}),
        ...(fault === "extra-field" ? { message: "private-server-detail" } : {}) } };
  } });
  const result = await client.callTool({ name: "send", arguments: { to: "all", body: "test" } });
  expect(result.isError).toBe(true);
  expect(JSON.parse(text(result))).toMatchObject({ outcome: "unknown", error: "operation-unavailable" });
  expect(text(result)).not.toContain("private-server-detail");
});
