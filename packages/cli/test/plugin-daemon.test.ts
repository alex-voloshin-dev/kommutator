import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pluginDaemonDiagnostics, pluginDaemonStatus, requirePluginDaemon, requirePluginDaemonForLookup } from "../src/plugin-daemon.js";
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
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: ["daemon.status", "daemon.runtime"].includes(request.method) ? (typeof status === "function" ? status() : status) : { bound: false } }) + "\n");
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

it("directs an older client to update itself without restarting the newer shared daemon", async () => {
  const calls = await daemon({ runtime_contract: 5, daemon: { version: "0.99.0" } });
  const result = await pluginDaemonDiagnostics();
  expect(result.recovery).toContain("The client is older");
  expect(result.recovery).toContain("Do not restart or downgrade the shared daemon");
  expect(result.recovery).not.toContain("bin/manage daemon restart");
  await expect(requirePluginDaemon()).rejects.toThrow("The client is older");
  expect(calls.every(method => ["ipc.hello", "daemon.status"].includes(method))).toBe(true);
});

it("uses the same directional recovery for pure lookup without leaking malformed daemon versions", async () => {
  const calls = await daemon({ runtime_contract: 5, daemon: { version: "private-fixture-not-a-version" } });
  const lookup = requirePluginDaemonForLookup();
  await expect(lookup).rejects.toThrow("The client is older");
  await expect(lookup).rejects.not.toThrow("private-fixture");
  await expect(lookup).rejects.toThrow("daemon unknown reports 5");
  expect(calls).toEqual(["ipc.hello", "daemon.runtime"]);
});


it.each([undefined, "x".repeat(65)])("retains newer-contract direction when lookup version metadata is %s", async version => {
  const calls = await daemon({ runtime_contract: 5, daemon: { version } });
  const lookup = requirePluginDaemonForLookup();
  await expect(lookup).rejects.toThrow("The client is older");
  await expect(lookup).rejects.toThrow("daemon unknown reports 5");
  await expect(lookup).rejects.not.toThrow("x".repeat(65));
  expect(calls).toEqual(["ipc.hello", "daemon.runtime"]);
});

it("does not guess lookup recovery direction for malformed contract metadata", async () => {
  const calls = await daemon({ runtime_contract: "private-fixture-contract", daemon: { version: "0.15.0" } });
  const lookup = requirePluginDaemonForLookup();
  await expect(lookup).rejects.toThrow("contract could not be verified");
  await expect(lookup).rejects.not.toThrow("private-fixture-contract");
  expect(calls).toEqual(["ipc.hello", "daemon.runtime"]);
});
