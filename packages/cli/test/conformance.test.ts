import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConformanceHarness } from "@kommutator/hub/testing";
import { DaemonCore, type HubTransport } from "@kommutator/agentd";
import { PROTOCOL_VERSION, RegisteredSession, Results } from "@kommutator/protocol";
import { z } from "zod";
import { createMcpServer } from "../src/mcp.js";
import { handleHook } from "../src/hooks.js";
import type { RpcClient } from "../src/ipc-client.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const hub = createConformanceHarness(); cleanup.push(() => hub.close());
  const connection = hub.connect("mac");
  const transport: HubTransport = {
    connected: true, start() {}, async close() { connection.disconnect(); },
    async request(method, params) { return connection.request(method, params); },
  };
  const core = new DaemonCore({ config: { hub: "http://127.0.0.1:8787", key: "test-key-with-16-characters", host: "mac" }, dbPath: ":memory:", transport, processStart: async () => "birth", isAlive: async () => true });
  cleanup.push(() => core.close());
  await core.start();
  async function session(id: string) {
    const hookPeer = core.peer();
    const hello = { protocol_version: PROTOCOL_VERSION, pid: 8001, ppid: 8000, cwd: "/same/project", vendor: "claude-code", vendor_session_id: id };
    await core.request(hookPeer, "ipc.hello", { ...hello, client: "hook" });
    const shim = core.peer();
    await core.request(shim, "ipc.hello", { ...hello, pid: 8002, client: "shim" });
    const rpc: RpcClient = { close() {}, call: (method, params = {}) => core.request(shim, method, params) };
    const hookRpc: RpcClient = { close() {}, call: (method, params = {}) => core.request(hookPeer, method, params) };
    const server = createMcpServer(rpc);
    const client = new Client({ name: "claude-code", version: "test" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    cleanup.push(() => server.close(), () => client.close());
    const identity = z.object({ session: RegisteredSession }).parse(await rpc.call("whoami"));
    return { client, rpc, hookRpc, identity: identity.session, payload: { session_id: id, cwd: "/same/project" } };
  }
  const sender = await session("sender");
  const receiver = await session("receiver");
  const send = async () => sender.client.callTool({ name: "send", arguments: { to: receiver.identity.handle, body: "Please inspect this change", kind: "request" } });
  return { sender, receiver, send };
}

describe("MCP and hooks against production daemon and hub conformance handlers", () => {
  it("returns distinct hub identities for same-folder sessions and leaves the sixth injected header unread", async () => {
    const { sender, receiver, send } = await fixture();
    expect(sender.identity.id).not.toBe(receiver.identity.id);
    const reply = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })) }).parse(await receiver.client.callTool({ name: "whoami", arguments: {} }));
    expect(JSON.parse(reply.content[0]!.text).session.handle).toBe(receiver.identity.handle);
    for (let index = 0; index < 6; index++) expect((await send()).isError).not.toBe(true);
    let output = "";
    await handleHook("PostToolUse", receiver.payload, receiver.hookRpc, async (text) => { output = text; });
    expect(output).toContain("+1 more unread");
    const unread = Results["inbox.list"].parse(await receiver.rpc.call("inbox.list", { unread_only: true }));
    expect(unread.headers.map((header) => header.seq)).toEqual([6]);
  });

  it("blocks Stop only once, preserves the guard through PostToolUse, and resets on new user input", async () => {
    const { receiver, send } = await fixture();
    await send();
    const outputs: string[] = [];
    const write = async (output: string) => { outputs.push(output); };
    await handleHook("Stop", receiver.payload, receiver.hookRpc, write);
    expect(JSON.parse(outputs[0]!).decision).toBe("block");
    await send();
    await handleHook("Stop", { ...receiver.payload, stop_hook_active: true }, receiver.hookRpc, write);
    expect(outputs).toHaveLength(1);
    await handleHook("PostToolUse", receiver.payload, receiver.hookRpc, write);
    await send();
    await handleHook("Stop", receiver.payload, receiver.hookRpc, write);
    expect(outputs).toHaveLength(2);
    await handleHook("UserPromptSubmit", receiver.payload, receiver.hookRpc, write);
    await send();
    await handleHook("Stop", receiver.payload, receiver.hookRpc, write);
    expect(outputs).toHaveLength(4);
    expect(JSON.parse(outputs[3]!).decision).toBe("block");
  });
});
