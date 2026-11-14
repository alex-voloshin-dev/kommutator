import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { createHubServer } from "@kommutator/hub";
import { openDatabase } from "@kommutator/hub/db";
import { PROTOCOL_VERSION, Results } from "@kommutator/protocol";
import { startDaemon } from "../src/daemon.js";
import { AlreadyRunningError } from "../src/ipc.js";
import { pathsFor } from "../src/paths.js";
import { HubLink } from "../src/hub-link.js";
import { WebSocketServer } from "ws";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const key = "test-key-at-least-sixteen";
const Reply = z.object({ id: z.union([z.number(), z.null()]), result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error("condition timeout"); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
async function environment() {
  const home = await mkdtemp(join(tmpdir(), "kom-daemon-"));
  cleanup.push(async () => rm(home, { recursive: true, force: true }));
  const db = openDatabase(":memory:");
  const server = createHubServer({ db, key });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing hub address");
  const config = { hub: `http://127.0.0.1:${address.port}`, key, host: "mac" };
  return { home, config, db };
}
async function ipc(path: string) {
  const socket = connect(path);
  await once(socket, "connect");
  const responses: z.infer<typeof Reply>[] = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (data: string) => {
    buffer += data;
    for (;;) { const end = buffer.indexOf("\n"); if (end < 0) break; responses.push(Reply.parse(JSON.parse(buffer.slice(0, end)))); buffer = buffer.slice(end + 1); }
  });
  let next = 0;
  cleanup.push(async () => { socket.destroy(); });
  return {
    socket,
    async call(method: string, params: unknown = {}) {
      const id = ++next;
      socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      await until(() => responses.some((reply) => reply.id === id));
      const reply = responses.find((candidate) => candidate.id === id);
      if (reply?.error) throw new Error(reply.error.message);
      return reply?.result;
    },
  };
}
async function closeSocket(socket: Socket) {
  if (socket.destroyed) return;
  socket.end();
  await once(socket, "close");
}

describe("production IPC and hub link", () => {
  it("uses one daemon for two clients, persists after one exits, and contains malformed frames", async () => {
    const { home, config } = await environment();
    const daemon = await startDaemon({ home, config, isAlive: async () => true, processStart: async () => "birth" });
    cleanup.push(daemon.close);
    await until(() => daemon.core.transport.connected);
    const first = await ipc(daemon.paths.ipc);
    const second = await ipc(daemon.paths.ipc);
    await first.call("ipc.hello", { client: "hook", protocol_version: PROTOCOL_VERSION, runtime_contract: 4, pid: 1000, ppid: 55, vendor: "claude-code", vendor_session_id: "a", cwd: "/repo" });
    await second.call("ipc.hello", { client: "shim", protocol_version: PROTOCOL_VERSION, runtime_contract: 4, pid: 1001, ppid: 55, vendor: "claude-code", vendor_session_id: "a", cwd: "/repo" });
    const identity = z.object({ session: z.object({ id: z.string(), handle: z.string() }) }).parse(await second.call("whoami"));
    expect(identity.session.handle).toMatch(/@mac$/);
    await closeSocket(first.socket);
    second.socket.write("this is not JSON\n");
    expect(z.object({ hub: z.object({ connected: z.boolean() }) }).parse(await second.call("daemon.status")).hub.connected).toBe(true);
    expect((await stat(daemon.paths.ipc)).mode & 0o777).toBe(0o600);
    expect((await stat(daemon.paths.home)).mode & 0o777).toBe(0o700);
    expect((await stat(daemon.paths.stateDb)).mode & 0o777).toBe(0o600);
    await expect(startDaemon({ home, config })).rejects.toBeInstanceOf(AlreadyRunningError);
    expect(Results["inbox.list"].parse(await second.call("inbox.list", {})).headers).toEqual([]);
  });
  it("concurrent fresh starters yield exactly one listening instance", async () => {
    const { home, config } = await environment();
    const starters = await Promise.allSettled([startDaemon({ home, config }), startDaemon({ home, config })]);
    const winners = starters.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    for (const result of starters) {
      if (result.status === "fulfilled") cleanup.push(result.value.close);
      else expect(result.reason).toBeInstanceOf(AlreadyRunningError);
    }
    const winner = winners[0];
    if (winner?.status !== "fulfilled") throw new Error("no winning daemon");
    const client = await ipc(winner.value.paths.ipc);
    await client.call("ipc.hello", { client: "cli", protocol_version: PROTOCOL_VERSION, runtime_contract: 4, pid: process.pid });
    expect(await client.call("daemon.status")).toBeDefined();
  });
  it("concurrent stale-socket reclaimers do not unlink the winning socket", async () => {
    const { home, config } = await environment();
    const endpoint = pathsFor(home).ipc;
    const child = spawn(process.execPath, ["-e", 'const net=require("node:net");net.createServer().listen(process.argv[1],()=>process.stdout.write("ready\\n"));', endpoint], { stdio: ["ignore", "pipe", "ignore"] });
    await once(child.stdout, "data");
    child.kill("SIGKILL");
    await once(child, "exit");
    const starters = await Promise.allSettled([startDaemon({ home, config }), startDaemon({ home, config })]);
    const winners = starters.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    for (const result of starters) { if (result.status === "fulfilled") cleanup.push(result.value.close); else expect(result.reason).toBeInstanceOf(AlreadyRunningError); }
    const winner = winners[0];
    if (winner?.status !== "fulfilled") throw new Error("no winning daemon");
    const client = await ipc(endpoint);
    await client.call("ipc.hello", { client: "cli", protocol_version: PROTOCOL_VERSION, runtime_contract: 4, pid: process.pid });
    expect(await client.call("daemon.status")).toBeDefined();
  });
  it("authenticates with Bearer, correlates replies, and repeats hello before reconnect sync", async () => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(wss, "listening");
    cleanup.push(async () => { for (const client of wss.clients) client.terminate(); await new Promise<void>((resolve) => wss.close(() => resolve())); });
    const address = wss.address();
    if (!address || typeof address === "string") throw new Error("missing socket address");
    const calls: string[] = [];
    const auth: Array<string | undefined> = [];
    wss.on("connection", (socket, req) => {
      auth.push(req.headers.authorization);
      socket.on("message", (frame) => {
        const value = z.object({ id: z.number(), method: z.string() }).parse(JSON.parse(frame.toString()));
        calls.push(value.method);
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: value.id, result: value.method === "hello" ? { host: "mac", protocol_version: PROTOCOL_VERSION,
          ...(auth.length === 1 ? { capabilities: ["resync-page-v1"] } : {}) } : { ok: true } }));
      });
    });
    const link = new HubLink({ host: "mac", key, hub: `http://127.0.0.1:${address.port}` });
    cleanup.push(() => link.close());
    let syncs = 0;
    link.start(async () => { await link.request("deliveries.resync", { acked: {} }); syncs++; }, () => {});
    await until(() => syncs === 1);
    expect(link.capabilities).toEqual(["resync-page-v1"]);
    const firstEpoch = link.epoch;
    const [one, two] = await Promise.all([link.request("one", {}), link.request("two", {})]);
    expect(one).toEqual({ ok: true });
    expect(two).toEqual({ ok: true });
    for (const client of wss.clients) client.terminate();
    await until(() => syncs === 2);
    expect(link.capabilities).toEqual([]);
    expect(link.epoch).toBeGreaterThan(firstEpoch);
    expect(auth).toEqual([`Bearer ${key}`, `Bearer ${key}`]);
    expect(calls.slice(0, 2)).toEqual(["hello", "deliveries.resync"]);
    expect(calls.slice(-2)).toEqual(["hello", "deliveries.resync"]);
  });
});
