import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { MAX_FRAME_BYTES } from "@kommutator/protocol";
import { startIpc } from "../src/ipc.js";
import { RpcError, OfflineError, DaemonStoppingError } from "../src/errors.js";

const Reply = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.number(), z.string(), z.null()]), result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(request: (method: string, params: unknown) => Promise<unknown>) {
  const home = await mkdtemp(join(tmpdir(), "kom-ipc-errors-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const path = join(home, "agentd.sock");
  let signalDisconnect!: () => void;
  const disconnected = new Promise<void>(resolve => { signalDisconnect = resolve; });
  const ipc = await startIpc({ path, peer: () => ({}), disconnect() { signalDisconnect(); }, request: (_peer, method, params) => request(method, params) });
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
  return { socket, replies, frames, until, send, disconnected };
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

it("keeps IPC usable through hub outage and distinguishes shutdown without exposing arbitrary errors", async () => {
  const client = await fixture(async method => {
    if (method === "offline") throw new OfflineError("secret-endpoint-token");
    if (method === "stopping") throw new DaemonStoppingError();
    if (method === "unexpected") throw new Error("secret-payload");
    return { healthy: true };
  });
  for (const method of ["offline", "stopping", "unexpected", "status"]) client.send(method, method);
  await client.until(4);
  expect(client.replies.map(row => row.error?.code)).toEqual([-32030, -32031, -32000, undefined]);
  expect(client.replies[3]?.result).toEqual({ healthy: true });
  expect(client.frames.join("")).not.toContain("secret");
  expect(client.frames.join("")).not.toContain("queued");
});

it("allows only bounded status lookups past a held mutation after successful hello", async () => {
  let releaseMutation!: () => void; const mutation = new Promise<void>(resolve => { releaseMutation = resolve; });
  let releaseLookup!: () => void; const lookup = new Promise<void>(resolve => { releaseLookup = resolve; });
  const calls: string[] = [];
  const client = await fixture(async method => {
    calls.push(method);
    if (method === "operation.submit") await mutation;
    if (method === "operation.status") await lookup;
    return { ok: true };
  });
  client.send("hello", "ipc.hello"); await client.until(1);
  client.send("mutation", "operation.submit"); client.send("next-mutation", "receipt.mark");
  for (let i = 0; i < 17; i++) client.send(`lookup-${i}`, "operation.status");
  await client.until(2);
  expect(client.replies[1]).toMatchObject({ id: "lookup-16", error: { code: -32024 } });
  expect(calls).toEqual(["ipc.hello", "operation.submit", "operation.status"]);
  releaseLookup(); await client.until(18);
  expect(calls.filter(method => method === "operation.status")).toHaveLength(16);
  expect(calls).not.toContain("receipt.mark");
  releaseMutation(); await client.until(20);
  expect(calls.at(-1)).toBe("receipt.mark");
});

it.each([false, true])("never bypasses pending or failed hello when failed=%s", async failed => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const client = await fixture(async method => {
    calls.push(method);
    if (method === "ipc.hello") { await gate; if (failed) throw new RpcError(-32020, "hello failed"); }
    return { ok: true };
  });
  client.send("hello", "ipc.hello"); client.send("lookup", "operation.status");
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(calls).toEqual(["ipc.hello"]);
  release(); await client.until(2);
  expect(calls).toEqual(["ipc.hello", "operation.status"]);
  expect(client.replies[0]?.id).toBe("hello");
});

it("drops queued lookup dispatches when their socket closes", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let lookups = 0;
  const client = await fixture(async method => {
    if (method === "operation.status") { lookups++; entered(); await gate; }
    return { ok: true };
  });
  client.send("hello", "ipc.hello"); await client.until(1);
  for (let i = 0; i < 8; i++) client.send(i, "operation.status");
  await started;
  const closed = once(client.socket, "close"); client.socket.destroy(); await closed; await client.disconnected;
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(lookups).toBe(1);
});
