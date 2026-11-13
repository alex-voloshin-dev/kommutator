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

it("shares fresh unbound preparation with concurrent calls without dispatching before hello", async () => {
  const methods: string[] = []; let hellos = 0; let ready: (() => void) | undefined;
  const f = await fixture((socket, request) => {
    methods.push(request.method);
    if (request.method === "ipc.hello") {
      hellos++;
      if (hellos === 1) response(socket, request.id, { bound: false });
      else ready = () => response(socket, request.id, { bound: true });
    } else response(socket, request.id, { ok: true });
  });
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 500 }); cleanup.push(() => client.close());
  await client.call("whoami");
  const submit = client.call("operation.submit"); const other = client.call("whoami");
  for (let i = 0; i < 50 && !ready; i++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(methods).toEqual(["ipc.hello", "whoami", "ipc.hello"]);
  if (!ready) throw new Error("missing fresh hello"); ready(); await Promise.all([submit, other]);
  expect(methods.filter(method => method === "operation.submit")).toHaveLength(1);
  expect(hellos).toBe(2);
});

it("never treats a timed-out call as idle for unbound connection preparation", async () => {
  const methods: string[] = [];
  const f = await fixture((socket, request) => {
    methods.push(request.method);
    if (request.method === "ipc.hello") response(socket, request.id, { bound: false });
  });
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 30 }); cleanup.push(() => client.close());
  await expect(client.call("whoami")).rejects.toThrow(/timed out/);
  await expect(client.call("operation.submit")).rejects.toThrow(/pending work/);
  expect(methods).toEqual(["ipc.hello", "whoami"]);
});

it("never starts a daemon for lookup when a pooled lazy-start client loses its socket after runtime preparation", async () => {
  const f = await fixture((socket, request) => response(socket, request.id, request.method === "ipc.hello" ? { bound: true } : { runtime_contract: 3, daemon: { version: "0.0.0" } }));
  let starts = 0;
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 100, lazyStart: true, spawn: () => { starts++; } }); cleanup.push(() => client.close());
  await client.call("daemon.runtime");
  for (const socket of f.sockets) socket.destroy();
  await rm(f.endpoint);
  await new Promise(resolve => setTimeout(resolve, 10));
  await expect(client.call("operation.status", { operation_id: "known" })).rejects.toThrow();
  expect(starts).toBe(0);
});
