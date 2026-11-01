import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginDaemonStatus, requirePluginDaemon } from "../src/plugin-daemon.js";
let home: string;
let server: Server | undefined;
const oldHome = process.env.KOM_HOME;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "kom-contract-")); process.env.KOM_HOME = home; });
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; await rm(home, { recursive: true, force: true }); if (oldHome === undefined) delete process.env.KOM_HOME; else process.env.KOM_HOME = oldHome; });
async function daemon(status: unknown) {
  const methods: string[] = [];
  server = createServer(socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end + 1);
        methods.push(request.method);
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: request.method === "daemon.status" ? (typeof status === "function" ? status() : status) : { bound: false } }) + "\n");
      }
    });
  });
  await new Promise<void>(resolve => server!.listen(join(home, "agentd.sock"), resolve));
  return methods;
}
it("reports stopped without starting a daemon", async () => { expect(await pluginDaemonStatus()).toBe("stopped"); });
it("rejects a legacy daemon without shutdown or session registration", async () => {
  const calls = await daemon({ daemon: { version: "0.0.0" } });
  await expect(requirePluginDaemon()).rejects.toThrow("No restart was performed");
  expect(calls).toEqual(["ipc.hello", "daemon.status"]);
});
it("supports concurrent root preflights against one compatible daemon", async () => {
  const calls = await daemon({ runtime_contract: 3 });
  await Promise.all([requirePluginDaemon(), requirePluginDaemon(), requirePluginDaemon()]);
  expect(calls.filter(method => method === "daemon.status")).toHaveLength(3);
  expect(calls.every(method => method === "ipc.hello" || method === "daemon.status")).toBe(true);
});

it("waits with status probes for a reconnect and never retries a session operation", async () => {
  let probes = 0;
  const calls = await daemon(() => ({ runtime_contract: 3, hub: { connected: ++probes >= 3 } }));
  await requirePluginDaemon();
  expect(probes).toBe(3);
  expect(calls).toEqual(["ipc.hello", "daemon.status", "daemon.status", "daemon.status"]);
});
it("bounds readiness waiting without disabling compatible offline queued sends", async () => {
  await daemon({ runtime_contract: 3, hub: { connected: false } });
  expect(await pluginDaemonStatus(false, 100, 25)).toBe("compatible");
});
