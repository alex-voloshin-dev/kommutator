import * as z from "zod";
import type { RpcClient } from "./ipc-client.js";

export function isCodexClient(info?: { name: string }): boolean {
  return /codex|chatgpt/i.test(info?.name ?? "");
}
const id = z.string().min(1).max(200);
const Metadata = z.object({
  sessionId: id, threadId: id,
  "x-codex-turn-metadata": z.object({ session_id: id, thread_id: id }).passthrough().optional(),
}).passthrough();

/** Vendor transport metadata is authoritative; model tool arguments never select identity. */
export function codexSessionId(meta: unknown): string {
  const parsed = Metadata.safeParse(meta);
  if (!parsed.success) throw new Error("Codex requires per-call sessionId and threadId metadata; update the local runtime");
  const value = parsed.data;
  const nested = value["x-codex-turn-metadata"];
  if (value.sessionId !== value.threadId) throw new Error("Codex fork/subagent MCP calls are unsupported; use an independent root session");
  if (nested && (nested.session_id !== value.sessionId || nested.thread_id !== value.threadId)) throw new Error("Conflicting Codex identity metadata");
  return value.sessionId;
}

/** A shared MCP process may serve many roots; each IPC connection remains identity-pinned. */
export class CodexClients {
  private readonly clients = new Map<string, RpcClient>();
  constructor(private readonly create: (id: string) => RpcClient, private readonly limit = 128) {}
  forCall(meta: unknown): RpcClient {
    const id = codexSessionId(meta);
    let client = this.clients.get(id);
    if (!client) {
      if (this.clients.size >= this.limit) throw new Error("Codex session limit reached; restart this MCP server");
      client = this.create(id);
      this.clients.set(id, client);
    }
    return client;
  }
  close(): void { for (const client of this.clients.values()) client.close(); this.clients.clear(); }
}
