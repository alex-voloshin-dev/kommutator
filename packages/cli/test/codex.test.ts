import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CodexClients, codexSessionId, isCodexClient } from "../src/codex.js";
import { createMcpServer } from "../src/mcp.js";
import { hookHello } from "../src/hooks.js";
import { shimHello } from "../src/ipc-client.js";

const meta = (id: string) => ({ sessionId: id, threadId: id, "x-codex-turn-metadata": { session_id: id, thread_id: id } });
describe("Codex per-call identity", () => {
  it("uses matching transport metadata, never a fallback for missing or fork identities", () => {
    expect(codexSessionId(meta("root-a"))).toBe("root-a");
    for (const value of [undefined, {}, { sessionId: "", threadId: "" }, { sessionId: "a", threadId: "b" }, { ...meta("a"), "x-codex-turn-metadata": { session_id: "b", thread_id: "a" } }]) expect(() => codexSessionId(value)).toThrow();
  });
  it("routes concurrent real SDK calls to separate pinned roots and rejects identity in tool arguments", async () => {
    const calls: string[] = [];
    const pool = new CodexClients((id) => ({ close() {}, async call() { await Promise.resolve(); calls.push(id); return { root: id }; } }));
    const server = createMcpServer((metadata) => pool.forCall(metadata));
    const client = new Client({ name: "codex-mcp-client", version: "0.164.0" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote); await client.connect(local);
    try {
      const replies = await Promise.all(["root-a", "root-b", "root-a"].map((id) => client.callTool({ name: "whoami", arguments: {}, _meta: meta(id) })));
      expect(replies.every((reply) => !reply.isError)).toBe(true);
      expect(calls.sort()).toEqual(["root-a", "root-a", "root-b"]);
      expect((await client.callTool({ name: "whoami", arguments: { sessionId: "root-a" } })).isError).toBe(true);
      expect(calls).toHaveLength(3);
    } finally { await client.close(); await server.close(); pool.close(); }
  });
  it("bounds the root pool without evicting active identities and closes every connection", () => {
    const close = vi.fn();
    const pool = new CodexClients(() => ({ close, async call() {} }), 1);
    expect(pool.forCall(meta("a"))).toBe(pool.forCall(meta("a")));
    expect(() => pool.forCall(meta("b"))).toThrow("limit");
    pool.close(); expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed metadata before IPC without poisoning the next valid SDK call", async () => {
    const call = vi.fn(async () => ({ root: "root-a" }));
    const create = vi.fn(() => ({ close() {}, call }));
    const pool = new CodexClients(create);
    const server = createMcpServer((metadata) => pool.forCall(metadata));
    const client = new Client({ name: "codex-mcp-client", version: "0.164.0" });
    const [local, remote] = InMemoryTransport.createLinkedPair();
    await server.connect(remote); await client.connect(local);
    try {
      expect((await client.callTool({ name: "whoami", arguments: {} })).isError).toBe(true);
      for (const metadata of [{}, { sessionId: "root-a", threadId: "child" },
        { ...meta("root-a"), "x-codex-turn-metadata": { session_id: "other", thread_id: "root-a" } }]) {
        expect((await client.callTool({ name: "whoami", arguments: {}, _meta: metadata })).isError).toBe(true);
      }
      expect(create).not.toHaveBeenCalled();
      expect(call).not.toHaveBeenCalled();
      const reply = await client.callTool({ name: "whoami", arguments: {}, _meta: meta("root-a") });
      expect(reply.isError).not.toBe(true);
      expect(reply.content).toEqual([{ type: "text", text: JSON.stringify({ root: "root-a" }) }]);
      expect(create).toHaveBeenCalledExactlyOnceWith("root-a");
      expect(call).toHaveBeenCalledExactlyOnceWith("whoami", {});
    } finally { await client.close(); await server.close(); pool.close(); }
  });
  it("ignores inherited Claude/Codex IDs when the vendor is Codex", () => {
    const prior = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = "ancestor";
    try {
      expect(isCodexClient({ name: "codex-mcp-client" })).toBe(true);
      expect(shimHello({ name: "codex-mcp-client" })).toMatchObject({ vendor: "codex" });
      expect(shimHello({ name: "codex-mcp-client" }).vendor_session_id).toBeUndefined();
      const hook = hookHello({ session_id: "actual" }, { CLAUDE_CODE_SESSION_ID: "ancestor", CLAUDE_CODE_MESSAGING_SOCKET: "wrong", CLAUDE_CODE_MESSAGING_TOKEN: "wrong", CODEX_SESSION_ID: "ancestor" }, "codex");
      expect(hook).toMatchObject({ vendor: "codex", vendor_session_id: "actual" });
      expect(hook.endpoint).toBeUndefined(); expect(hook.token).toBeUndefined();
    } finally { if (prior === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = prior; }
  });
});
