import { afterEach, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateSetup } from "../src/setup.js";
import { pluginContext, savePluginContext } from "../src/plugin-context.js";
let home: string;
const oldHome = process.env.KOM_HOME;
const setups: PrivateSetup[] = [];
const servers: Server[] = [];
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "kom-qa-boundary-")); process.env.KOM_HOME = home; });
afterEach(async () => {
  for (const setup of setups.splice(0)) setup.close();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  if (oldHome === undefined) delete process.env.KOM_HOME; else process.env.KOM_HOME = oldHome;
  await rm(home, { recursive: true, force: true });
});
async function form() {
  const setup = new PrivateSetup(); setups.push(setup);
  const { url } = await setup.start(); if (!url) throw new Error("missing form"); return new URL(url);
}
function post(url: URL, hub: string, key: string, origin: string = url.origin) {
  return fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: url.pathname.slice(1), hub, host: "qa-host", key }) });
}
async function fakeHub(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing port");
  return `http://127.0.0.1:${address.port}`;
}
it("rejects opaque null origins and token-path guesses before contacting the hub", async () => {
  let calls = 0;
  const hub = await fakeHub((_req, res) => { calls++; res.end(); });
  const url = await form();
  expect((await post(url, hub, "private-fixture-key", "null")).status).toBe(403);
  const guessed = new URL("/wrong-token", url);
  expect((await post(guessed, hub, "private-fixture-key")).status).toBe(403);
  expect(calls).toBe(0);
  expect(await readdir(home)).not.toContain("config.json");
});
it("never follows an authenticated setup redirect or writes a rejected configuration", async () => {
  let forwarded = 0;
  const target = await fakeHub((_req, res) => { forwarded++; res.end('{}'); });
  const redirect = await fakeHub((_req, res) => { res.writeHead(302, { Location: target }); res.end(); });
  const response = await post(await form(), redirect, "private-fixture-key");
  expect(response.status).toBe(400); expect(await response.text()).not.toContain("private-fixture-key");
  expect(forwarded).toBe(0); expect(await readdir(home)).not.toContain("config.json");
});
it("two independent setup servers commit one complete config and never overwrite the winner", async () => {
  const hub = await fakeHub((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ protocol_version: 1, runtime_contract: 4, sessions: [] })); });
  const [a, b] = await Promise.all([form(), form()]);
  const results = await Promise.all([post(a, hub, "first-private-key"), post(b, hub, "second-private-key")]);
  expect(results.map(result => result.status).sort()).toEqual([200, 400]);
  const saved = JSON.parse(await readFile(join(home, "config.json"), "utf8")) as { key: string };
  expect(saved.key).toBe(results[0]?.status === 200 ? "first-private-key" : "second-private-key");
  expect((await readdir(home)).filter(path => path.endsWith(".tmp"))).toEqual([]);
});
it("preserves a malformed config created while a setup form is open", async () => {
  const hub = await fakeHub((_req, res) => { res.end(JSON.stringify({ protocol_version: 1, runtime_contract: 4, sessions: [] })); });
  const url = await form();
  await writeFile(join(home, "config.json"), "malformed concurrent file");
  expect((await post(url, hub, "private-fixture-key")).status).toBe(400);
  expect(await readFile(join(home, "config.json"), "utf8")).toBe("malformed concurrent file");
});
it("concurrent root context writers cannot replace an established root and leave no temporary files", async () => {
  const result = await Promise.allSettled([savePluginContext("codex", "root", "/one"), savePluginContext("codex", "root", "/two")]);
  expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
  const winner = await pluginContext("codex", "root");
  expect(["/one", "/two"]).toContain(winner);
  await savePluginContext("codex", "other-root", winner);
  await expect(savePluginContext("codex", "root", "/child")).rejects.toThrow("Conflicting project context");
  expect(await pluginContext("codex", "root")).toBe(winner);
  expect(await pluginContext("codex", "other-root")).toBe(winner);
  expect((await readdir(join(home, "contexts"))).filter(path => path.endsWith(".tmp"))).toEqual([]);
});
it("never returns a Claude registration for another root and removes replay authority on SessionEnd", async () => {
  const { saveClaudeRegistration, claudeRegistration, forgetClaudeRegistration } = await import("../src/plugin-context.js");
  await savePluginContext("claude-code", "root-a", "/project");
  await saveClaudeRegistration({ client: "hook", protocol_version: 1, runtime_contract: 4, pid: process.pid, ppid: process.pid, vendor: "claude-code", vendor_session_id: "root-a", cwd: "/project" });
  expect(await claudeRegistration("root-a", process.pid)).toMatchObject({ vendor_session_id: "root-a", ppid: process.pid, cwd: "/project" });
  await expect(claudeRegistration("root-b", process.pid)).rejects.toThrow("unavailable or expired");
  await forgetClaudeRegistration("root-a", process.pid);
  await expect(claudeRegistration("root-a", process.pid)).rejects.toThrow("unavailable or expired");
  expect(await pluginContext("claude-code", "root-a")).toBe("/project");
});

it("rejects saved registration after its observed owner exits", async () => {
  const { saveClaudeRegistration, claudeRegistration } = await import("../src/plugin-context.js");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  try {
    if (!child.pid) throw new Error("missing child pid");
    await savePluginContext("claude-code", "dead-owner", "/project");
    await saveClaudeRegistration({ client: "hook", protocol_version: 1, runtime_contract: 4, pid: process.pid, ppid: child.pid, vendor: "claude-code", vendor_session_id: "dead-owner", cwd: "/project" });
    expect((await claudeRegistration("dead-owner", child.pid)).ppid).toBe(child.pid);
    const ended = new Promise<void>(resolve => child.once("close", () => resolve()));
    child.kill("SIGTERM"); await ended;
    await expect(claudeRegistration("dead-owner", child.pid)).rejects.toThrow("unavailable or expired");
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); }
});
