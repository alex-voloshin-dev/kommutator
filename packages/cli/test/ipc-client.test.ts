import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { confirmDaemonStopped } from "../src/daemon-stop.js";
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
  return { endpoint, sockets, server };
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
  const f = await fixture((socket, request) => response(socket, request.id, request.method === "ipc.hello" ? { bound: true } : { runtime_contract: 4, daemon: { version: "0.0.0" } }));
  let starts = 0;
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 100, lazyStart: true, spawn: () => { starts++; } }); cleanup.push(() => client.close());
  await client.call("daemon.runtime");
  for (const socket of f.sockets) socket.destroy();
  await rm(f.endpoint);
  await new Promise(resolve => setTimeout(resolve, 10));
  await expect(client.call("operation.status", { operation_id: "known" })).rejects.toThrow();
  expect(starts).toBe(0);
});

it("uses the declared startup budget beyond the old six-retry window, spawning once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-delayed-start-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const endpoint = join(directory, "agentd.sock");
  const sockets: Socket[] = []; const methods: string[] = [];
  const server = createServer(socket => {
    sockets.push(socket); let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk); let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end)) as { id: number; method: string }; buffer = buffer.slice(end + 1);
        methods.push(request.method); response(socket, request.id, { ok: true });
      }
    });
  });
  let starts = 0; let timer: NodeJS.Timeout | undefined;
  const client = new IpcClient({ endpoint, hello: cliHello, timeoutMs: 5000, lazyStart: true,
    spawn: () => { starts++; timer = setTimeout(() => server.listen(endpoint), 2200); } });
  cleanup.push(async () => { client.close(); if (timer) clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await expect(client.call("daemon.status")).resolves.toMatchObject({ ok: true });
  expect(starts).toBe(1); expect(methods).toEqual(["ipc.hello", "daemon.status"]);
}, 7000);

it("cancels startup backoff immediately and does not connect after close", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-cancel-start-")); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let starts = 0;
  const client = new IpcClient({ endpoint: join(directory, "absent.sock"), hello: cliHello, timeoutMs: 5000, lazyStart: true, spawn: () => { starts++; } });
  const pending = client.call("daemon.status");
  const rejected = expect(pending).rejects.toThrow("closed");
  await new Promise(resolve => setTimeout(resolve, 20)); client.close(); await rejected;
  expect(starts).toBe(1);
});

it("bounds startup when no listener appears without replaying spawn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kom-bounded-start-")); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let starts = 0;
  const client = new IpcClient({ endpoint: join(directory, "absent.sock"), hello: cliHello, timeoutMs: 100, lazyStart: true, spawn: () => { starts++; } }); cleanup.push(() => client.close());
  const start = performance.now(); await expect(client.call("daemon.status")).rejects.toThrow(/Daemon/);
  expect(performance.now() - start).toBeLessThan(500); expect(starts).toBe(1);
});


it("confirms shutdown through ordinary transport closure then a fresh absent probe", async () => {
  let shutdowns = 0; let statuses = 0;
  const f = await fixture((socket, request) => {
    if (request.method === "ipc.hello") response(socket, request.id, { bound: false });
    else if (request.method === "daemon.shutdown") { shutdowns++; response(socket, request.id, { ok: true }); }
    else { statuses++; f.server.close(); socket.end(); }
  });
  await confirmDaemonStopped(async (method, timeoutMs) => {
    const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs, lazyStart: false });
    try { return await client.call(method); } finally { client.close(); }
  });
  expect(shutdowns).toBe(1); expect(statuses).toBe(1);
});


it("shares one lazy startup and hello across concurrent calls before dispatch", async () => {
  const methods: string[] = [];
  let releaseHello: (() => void) | undefined;
  let helloObserved!: () => void;
  const hello = new Promise<void>(resolve => { helloObserved = resolve; });
  const f = await fixture((socket, request) => {
    methods.push(request.method);
    if (request.method === "ipc.hello") {
      releaseHello = () => response(socket, request.id, { bound: true });
      helloObserved();
    } else response(socket, request.id, { ok: true });
  });
  await new Promise<void>(resolve => f.server.close(() => resolve()));
  let starts = 0;
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 1000, lazyStart: true,
    spawn: () => { starts++; f.server.listen(f.endpoint); } });
  cleanup.push(() => client.close());
  const calls = Promise.all([client.call("daemon.status"), client.call("message.send", { body: "once" })]);
  await hello;
  expect(starts).toBe(1);
  expect(f.sockets).toHaveLength(1);
  expect(methods).toEqual(["ipc.hello"]);
  if (!releaseHello) throw new Error("missing hello response barrier");
  releaseHello();
  await expect(calls).resolves.toEqual([{ ok: true }, { ok: true }]);
  expect(methods).toEqual(["ipc.hello", "daemon.status", "message.send"]);
});

it("cancels concurrent calls during hello without dispatching or starting a replacement", async () => {
  const methods: string[] = [];
  let helloObserved!: () => void;
  const hello = new Promise<void>(resolve => { helloObserved = resolve; });
  const f = await fixture((_socket, request) => { methods.push(request.method); helloObserved(); });
  let starts = 0;
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 5000, lazyStart: true, spawn: () => { starts++; } });
  cleanup.push(() => client.close());
  const first = expect(client.call("message.send")).rejects.toThrow("closed");
  const second = expect(client.call("daemon.status")).rejects.toThrow("closed");
  await hello;
  client.close();
  await Promise.all([first, second]);
  await expect(client.call("daemon.status")).rejects.toThrow("closed");
  expect(methods).toEqual(["ipc.hello"]);
  expect(starts).toBe(0);
});

it("cancels a socket opening before its connect event without sending hello", async () => {
  const methods: string[] = [];
  const f = await fixture((_socket, request) => { methods.push(request.method); });
  let starts = 0;
  const client = new IpcClient({ endpoint: f.endpoint, hello: cliHello, timeoutMs: 5000, lazyStart: true, spawn: () => { starts++; } });
  cleanup.push(() => client.close());
  const rejected = expect(client.call("message.send")).rejects.toThrow("closed");
  client.close();
  await rejected;
  await expect(client.call("daemon.status")).rejects.toThrow("closed");
  expect(methods).toEqual([]);
  expect(starts).toBe(0);
});
