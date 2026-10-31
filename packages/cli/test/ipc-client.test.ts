import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IpcClient, cliHello } from "../src/ipc-client.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const callback of cleanup.splice(0).reverse()) await callback(); });
async function fixture(reply: (socket: Socket, request: { id: number; method: string; params: unknown }) => void) {
  const dir = await mkdtemp(join(tmpdir(), "kom-ipc-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const endpoint = join(dir, "agentd.sock");
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket); socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (text) => {
      buffer += text;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        reply(socket, JSON.parse(line));
      }
    });
  });
  cleanup.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  await listen(server, endpoint);
  return { endpoint, sockets };
}
function listen(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(endpoint, () => { server.off("error", reject); resolve(); }); });
}
function response(socket: Socket, id: number, result: unknown) { socket.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); }

describe("IPC client", () => {
  it("handshakes each connection and reconnects the next call after daemon disconnect", async () => {
    const methods: string[] = [];
    const { endpoint, sockets } = await fixture((socket, request) => { methods.push(request.method); response(socket, request.id, { ok: true }); });
    const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 100 });
    cleanup.push(() => client.close());
    await client.call("daemon.status");
    sockets[0]?.destroy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.call("daemon.status");
    expect(methods).toEqual(["ipc.hello", "daemon.status", "ipc.hello", "daemon.status"]);
  });

  it("does not replay a mutation when its acknowledgement is lost", async () => {
    let sends = 0;
    const { endpoint } = await fixture((socket, request) => {
      if (request.method === "message.send") { sends++; socket.destroy(); }
      else response(socket, request.id, { ok: true });
    });
    const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 100 });
    cleanup.push(() => client.close());
    await expect(client.call("message.send", { message: { body: "one message" } })).rejects.toThrow("do not resend blindly");
    expect(sends).toBe(1);
  });

  it("rejects malformed daemon responses without hanging", async () => {
    const { endpoint } = await fixture((socket) => socket.write("null\n"));
    const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 100 });
    cleanup.push(() => client.close());
    await expect(client.call("daemon.status")).rejects.toThrow("Malformed IPC response");
  });

  it("rejects an envelope without either result or error", async () => {
    const { endpoint } = await fixture((socket, request) => socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id }) + "\n"));
    const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 100 });
    cleanup.push(() => client.close());
    await expect(client.call("daemon.status")).rejects.toThrow("Malformed IPC response");
  });

  it("bounds a silent daemon and never replays the timed-out request", async () => {
    let calls = 0;
    const { endpoint } = await fixture((socket, request) => {
      calls++;
      if (request.method === "ipc.hello") response(socket, request.id, { ok: true });
    });
    const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 20 });
    cleanup.push(() => client.close());
    await expect(client.call("message.send")).rejects.toThrow("timed out");
    expect(calls).toBe(2);
  });
});
