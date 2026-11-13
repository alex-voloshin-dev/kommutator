import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginDaemonDiagnostics, pluginDaemonStatus, requirePluginDaemon } from "../src/plugin-daemon.js";
import { PrivateSetup } from "../src/setup.js";
import { RELEASE_VERSION } from "@kommutator/protocol";
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
  const preparation = requirePluginDaemon();
  await expect(preparation).rejects.toThrow("No restart was performed");
  await expect(preparation).rejects.toMatchObject({ code: -32601 });
  expect(calls).toEqual(["ipc.hello", "daemon.status"]);
});
it("supports concurrent root preflights against one compatible daemon", async () => {
  const calls = await daemon({ runtime_contract: 4 });
  await Promise.all([requirePluginDaemon(), requirePluginDaemon(), requirePluginDaemon()]);
  expect(calls.filter(method => method === "daemon.status")).toHaveLength(3);
  expect(calls.every(method => method === "ipc.hello" || method === "daemon.status")).toBe(true);
});

it("waits with status probes for a reconnect and never retries a session operation", async () => {
  let probes = 0;
  const calls = await daemon(() => ({ runtime_contract: 4, hub: { connected: ++probes >= 3 } }));
  await requirePluginDaemon();
  expect(probes).toBe(3);
  expect(calls).toEqual(["ipc.hello", "daemon.status", "daemon.status", "daemon.status"]);
});
it("bounds readiness waiting without disabling compatible offline queued sends", async () => {
  await daemon({ runtime_contract: 4, hub: { connected: false } });
  expect(await pluginDaemonStatus(false, 100, 25)).toBe("compatible");
});

it("setup reports observed and required versions with actionable recovery without changing the daemon", async () => {
  await writeFile(join(home, "config.json"), JSON.stringify({ host: "fixture", hub: "http://127.0.0.1:8787", key: "private-fixture-credential" }));
  const calls = await daemon({ runtime_contract: 2, daemon: { version: "0.4.0" }, key: "private-fixture-credential", sessions: [{ token: "vendor-secret" }] });
  const result = await new PrivateSetup().status();
  expect(result).toMatchObject({ configured: true, daemon: "incompatible", client_version: RELEASE_VERSION, expected_runtime_contract: 4, daemon_version: "0.4.0", daemon_runtime_contract: 2 });
  expect(JSON.stringify(result)).toContain("bin/manage daemon restart");
  expect(JSON.stringify(result)).toContain("After ending active sessions");
  expect(JSON.stringify(result)).toContain("all lifecycle hook wiring");
  expect(JSON.stringify(result)).toContain("new client OS process");
  expect(JSON.stringify(result)).toContain("Reloading plugins in the old process is insufficient");
  expect(JSON.stringify(result)).not.toMatch(/private-fixture-credential|vendor-secret/);
  expect(calls).toEqual(["ipc.hello", "daemon.status"]);
});
it("reports unknown legacy fields and filters malformed version metadata", async () => {
  await daemon({ daemon: { version: "secret not a version" }, runtime_contract: "secret" });
  expect(await pluginDaemonDiagnostics()).toMatchObject({ daemon: "incompatible", daemon_version: null, daemon_runtime_contract: null });
});
it("reports stopped diagnostics without startup and compatible runtime metadata without recovery", async () => {
  expect(await pluginDaemonDiagnostics()).toMatchObject({ daemon: "stopped", daemon_version: null, daemon_runtime_contract: null, recovery: expect.stringContaining("No daemon was started") });
  await daemon({ runtime_contract: 4, daemon: { version: "0.5.0" } });
  const result = await pluginDaemonDiagnostics();
  expect(result).toMatchObject({ daemon: "compatible", daemon_version: "0.5.0", daemon_runtime_contract: 4 });
  expect(result).not.toHaveProperty("recovery");
});
