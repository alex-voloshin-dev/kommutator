import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConformanceHarness } from "@kommutator/hub/testing";
import { DaemonCore, type HubTransport } from "@kommutator/agentd";
import { PROTOCOL_VERSION, RegisteredSession, Results } from "@kommutator/protocol";
import { z } from "zod";
import { createMcpServer } from "../src/mcp.js";
import { handleHook } from "../src/hooks.js";
import { IpcError, type Hello, type RpcClient } from "../src/ipc-client.js";
import { ClaudePluginClient } from "../src/claude.js";

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


it("recovers a retired ClaudePluginClient through real daemon and hub handlers without changing identity or replaying sends", async () => {
  const hub = createConformanceHarness(); cleanup.push(() => hub.close());
  const connection = hub.connect("mac");
  const methods: string[] = [];
  const transport: HubTransport = {
    connected: true, start() {}, async close() { connection.disconnect(); },
    async request(method, params) { methods.push(method); return connection.request(method, params); },
  };
  let birth: string | undefined = "birth";
  const core = new DaemonCore({ config: { hub: "http://127.0.0.1:8787", key: "test-key-with-16-characters", host: "mac" },
    dbPath: ":memory:", transport, processStart: async () => birth, processExists: () => false,
    adapters: [{ vendor: "claude-code", capability: "hook", isAlive: async () => true, deliver: async () => ({ outcome: "inbox" }) }] });
  cleanup.push(() => core.close()); await core.start();
  const hello: Hello = { client: "hook", protocol_version: PROTOCOL_VERSION, pid: 8001, ppid: 8000,
    cwd: "/same/project", vendor: "claude-code", vendor_session_id: "recover-composed", owner_generation: 1 };
  const first = core.peer(); await core.request(first, "ipc.hello", hello);
  await core.request(first, "session.upsert", { op: "update", session: { role: "reviewer" } });
  const before = z.object({ session: RegisteredSession, topics: z.array(z.unknown()) }).parse(await core.request(first, "whoami"));
  let shims = 0;
  const makeClient = (binding: Hello): RpcClient => {
    const peer = core.peer();
    let bound = false;
    return { close() {}, async call(method, params = {}) {
      try {
        if (!bound) { await core.request(peer, "ipc.hello", binding); bound = true; }
        return await core.request(peer, method, params);
      } catch (error) {
        if (error instanceof Error && "code" in error && typeof error.code === "number") throw new IpcError(error.message, error.code);
        throw error;
      }
    } };
  };
  const client = new ClaudePluginClient({ resolve: async () => ({ hello, birth: "birth", generation: "birth:1" }),
    prepare: async () => {}, hook: makeClient,
    shim: observed => { shims++; return makeClient({ ...observed, client: "shim", pid: 8002 }); } });
  cleanup.push(() => client.close());
  await client.call("whoami");
  birth = undefined; await core.sweep(); birth = "birth";
  const sent = Results["send.local"].parse(await client.call("message.send", { message: { to: [before.session.handle], body: "exactly once after recovery" } }));
  const after = z.object({ session: RegisteredSession, topics: z.array(z.unknown()) }).parse(await client.call("whoami"));
  expect(after.session).toMatchObject({ id: before.session.id, role: "reviewer", incarnation: before.session.incarnation + 1 });
  expect(after.topics).toEqual(before.topics);
  expect(shims).toBe(2);
  expect(methods.filter(method => method === "message.send")).toHaveLength(1);
  expect(Results["inbox.list"].parse(await client.call("inbox.list", { unread_only: true })).headers.map(header => header.id)).toEqual([sent.id]);
  expect(methods).not.toContain("receipt.mark");
  await expect(core.request(first, "whoami")).rejects.toThrow("ended");
});


it("drains a 130-message backlog through MCP ack/read without replaying the final fifty unread headers", async () => {
  const { sender, receiver, send } = await fixture();
  const toolReply = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    const reply = await client.callTool({ name, arguments: args });
    expect(reply.isError).not.toBe(true);
    const text = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1) }).parse(reply);
    return JSON.parse(text.content[0]!.text);
  };
  const inbox = async () => Results["inbox.list"].parse(await toolReply(receiver.client, "inbox", { unread_only: true }));
  for (let index = 0; index < 130; index++) expect((await send()).isError).not.toBe(true);
  const first = await inbox();
  expect(first.headers).toHaveLength(50);
  expect(first).toMatchObject({ cursor: 50, more: true });
  // Merely listing the same unread page must not create receipts.
  expect(await inbox()).toEqual(first);
  expect(await toolReply(receiver.client, "ack", { ids: first.headers.map(header => header.id) })).toEqual({ ok: true });
  const second = await inbox();
  expect(second.headers.map(header => header.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 51));
  expect(second.more).toBe(true);
  expect(await toolReply(receiver.client, "ack", { ids: second.headers.slice(0, 29).map(header => header.id) })).toEqual({ ok: true });
  const last = Results["inbox.list"].parse(await toolReply(receiver.client, "inbox", { since_seq: 129 }));
  expect(last.headers.map(header => header.seq)).toEqual([130]);
  expect(await toolReply(receiver.client, "read", { id: last.headers[0]!.id })).toMatchObject({ state: "read" });
  const remaining = await inbox();
  expect(remaining.headers.map(header => header.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 80));
  expect(remaining).toMatchObject({ cursor: 129, more: false });

  // Sequence cursors are not message IDs; the current acknowledgement contract ignores unmatched IDs.
  expect(await toolReply(receiver.client, "ack", { ids: remaining.headers.map(header => String(header.seq)) })).toEqual({ ok: true });
  expect(await inbox()).toEqual(remaining);

  // A different recipient cannot acknowledge this mailbox; ok alone is not proof of a change.
  expect(await toolReply(sender.client, "ack", { ids: remaining.headers.map(header => header.id) })).toEqual({ ok: true });
  expect(await inbox()).toEqual(remaining);
  expect(await toolReply(receiver.client, "ack", { ids: remaining.headers.map(header => header.id) })).toEqual({ ok: true });
  expect(await inbox()).toMatchObject({ headers: [], cursor: 0, more: false });
  expect(await inbox()).toMatchObject({ headers: [], more: false });
  await send();
  const next = await inbox();
  expect(next.headers.map(header => header.seq)).toEqual([131]);
  expect(await toolReply(receiver.client, "read", { id: next.headers[0]!.id })).toMatchObject({ state: "read" });
  expect(await inbox()).toMatchObject({ headers: [], more: false });
});
