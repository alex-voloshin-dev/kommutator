import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { MAX_FRAME_BYTES } from "@kommutator/protocol";
import { startIpc } from "../src/ipc.js";
import { RpcError } from "../src/errors.js";

const Reply = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.number(), z.string(), z.null()]), result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(request: (method: string, params: unknown) => Promise<unknown>) {
  const home = await mkdtemp(join(tmpdir(), "kom-ipc-errors-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "agentd.sock");
  const ipc = await startIpc({ path, peer: () => ({}), disconnect() {}, request: (_peer, method, params) => request(method, params) });
  cleanup.push(ipc.close);
  const socket = connect(path);
  cleanup.push(() => { socket.destroy(); });
  await once(socket, "connect");
  const replies: z.infer<typeof Reply>[] = [];
  const frames: string[] = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (data: string) => {
    buffer += data;
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      frames.push(frame); replies.push(Reply.parse(JSON.parse(frame) as unknown));
    }
  });
  async function until(count: number): Promise<void> {
    const deadline = Date.now() + 1_000;
    while (replies.length < count) {
      if (socket.destroyed || Date.now() > deadline) throw new Error("IPC response did not arrive on the existing connection");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  const send = (id: number | string, method: string) => socket.write(JSON.stringify({ jsonrpc: "2.0", id, method }) + "\n");
  return { socket, replies, frames, until, send };
}

describe("local IPC response and envelope boundaries", () => {
  it.each([7, "large-result"])("returns a bounded oversized-result error with original id %s and keeps the connection usable", async (id) => {
    const client = await fixture(async (method) => method === "large" ? "😀".repeat(MAX_FRAME_BYTES / 2) : { healthy: true });
    client.send(id, "large");
    await client.until(1);
    expect(client.replies[0]).toEqual({ jsonrpc: "2.0", id, error: { code: -32011, message: "result exceeds frame limit; narrow query or reduce page size" } });
    expect(Buffer.byteLength(client.frames[0] ?? "")).toBeLessThan(MAX_FRAME_BYTES);
    client.send("next", "status");
    await client.until(2);
    expect(client.replies[1]).toEqual({ jsonrpc: "2.0", id: "next", result: { healthy: true } });
    expect(client.socket.destroyed).toBe(false);
  });

  it("distinguishes JSON parse errors from invalid envelopes and continues dispatching", async () => {
    const calls: string[] = [];
    const client = await fixture(async (method) => { calls.push(method); return { ok: true }; });
    client.socket.write('{broken\nnull\n[]\n{"jsonrpc":"2.0","id":1,"method":42}\n');
    client.send("after-invalid", "status");
    await client.until(5);
    expect(client.replies.slice(0, 4).map((reply) => ({ id: reply.id, code: reply.error?.code }))).toEqual([
      { id: null, code: -32700 }, { id: null, code: -32600 }, { id: null, code: -32600 }, { id: null, code: -32600 },
    ]);
    expect(client.replies[4]).toMatchObject({ id: "after-invalid", result: { ok: true } });
    expect(calls).toEqual(["status"]);
  });

  it.each([undefined, null])("executes notifications with id %s silently, including large results and thrown errors", async (id) => {
    const calls: string[] = [];
    const client = await fixture(async (method) => {
      calls.push(method);
      if (method === "throw") throw new RpcError(-32602, "invalid parameters");
      if (method === "large") return "x".repeat(MAX_FRAME_BYTES);
      return { ok: true };
    });
    for (const method of ["large", "throw"]) client.socket.write(JSON.stringify({ jsonrpc: "2.0", id, method }) + "\n");
    client.send("barrier", "status");
    await client.until(1);
    expect(client.replies).toEqual([{ jsonrpc: "2.0", id: "barrier", result: { ok: true } }]);
    expect(calls).toEqual(["large", "throw", "status"]);
  });
});
