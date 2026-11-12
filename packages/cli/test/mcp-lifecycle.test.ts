import { expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, McpLifecycle } from "../src/mcp.js";
import type { RpcClient } from "../src/ipc-client.js";

it.each(["resolve", "call"])("cleans resources created after closure during pending %s", async stage => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let openResources = 0, calls = 0;
  const rpc: RpcClient = { close() { openResources = 0; }, async call() {
    calls++;
    if (stage === "call") { entered.resolve(); await gate.promise; openResources++; }
    return {};
  } };
  const lifecycle = new McpLifecycle(() => rpc.close());
  const server = createMcpServer(async () => {
    if (stage === "resolve") { entered.resolve(); await gate.promise; openResources++; }
    return rpc;
  }, undefined, lifecycle);
  const client = new Client({ name: "claude-code", version: "fixture" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right); await client.connect(left);
    const pending = client.callTool({ name: "whoami", arguments: {} });
    await entered.promise;
    lifecycle.close();
    gate.resolve();
    const reply = await pending;
    expect(openResources).toBe(0);
    expect(calls).toBe(stage === "resolve" ? 0 : 1);
    if (stage === "resolve") expect(reply.isError).toBe(true);
    const rejected = await client.callTool({ name: "whoami", arguments: {} });
    expect(rejected.isError).toBe(true);
    expect(calls).toBe(stage === "resolve" ? 0 : 1);
  } finally { gate.resolve(); await client.close(); await server.close(); }
});
