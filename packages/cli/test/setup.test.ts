import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { PrivateSetup } from "../src/setup.js";
import { savePluginContext, pluginContext, saveClaudeRegistration, claudeRegistration } from "../src/plugin-context.js";
import { shimHello } from "../src/ipc-client.js";
let home: string;
let setup: PrivateSetup;
const original = process.env.KOM_HOME;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "kom-private-")); process.env.KOM_HOME = home; setup = new PrivateSetup(); });
afterEach(async () => { setup.close(); if (original === undefined) delete process.env.KOM_HOME; else process.env.KOM_HOME = original; await rm(home, { recursive: true, force: true }); });
async function form() { const result = await setup.start(); if (!result.url) throw new Error("missing URL"); return new URL(result.url); }
function post(url: URL, values: Record<string, string>, origin = url.origin) { return fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrf: url.pathname.slice(1), ...values }) }); }
describe("private plugin setup", () => {
  it("shares one expiring form and rejects foreign origin and CSRF without revealing secrets", async () => {
    const [a,b] = await Promise.all([setup.start(), setup.start()]); expect(a.url).toBe(b.url);
    if (!a.url) throw new Error("missing setup URL");
    const url = new URL(a.url);
    expect((await post(url, { key: "private-secret-not-for-model" }, "https://evil.example")).status).toBe(403);
    expect((await post(url, { csrf: "wrong", key: "private-secret-not-for-model" })).status).toBe(403);
    const bad = await post(url, { hub: "not a URL", host: "x", key: "private-secret-not-for-model" });
    expect(await bad.text()).not.toContain("private-secret");
    expect(await setup.status()).toEqual({ configured: false });
  });
  it("authenticates the hub then creates private config and reuses it", async () => {
    const key = "private-secret-auth-test";
    const hub = createServer((req,res) => { if (req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401); res.end(); return; } res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ protocol_version: 1, sessions: [] })); });
    await new Promise<void>(resolve => hub.listen(0, "127.0.0.1", resolve));
    try {
      const address = hub.address(); if (!address || typeof address === "string") throw new Error("address");
      const url = await form();
      expect((await post(url, { hub: `http://127.0.0.1:${address.port}`, host: "my_host", key })).status).toBe(200);
      expect(JSON.parse(await readFile(join(home, "config.json"), "utf8")).key).toBe(key);
      expect((await stat(join(home, "config.json"))).mode & 0o777).toBe(0o600);
      expect(await setup.start()).toEqual({ configured: true });
    } finally { hub.closeAllConnections(); await new Promise<void>(resolve => hub.close(() => resolve())); }
  });
  it("will not overwrite malformed existing configuration", async () => {
    await writeFile(join(home, "config.json"), "invalid");
    await expect(setup.start()).rejects.toThrow("will not overwrite");
    expect(await readFile(join(home, "config.json"), "utf8")).toBe("invalid");
  });
  it("maps projects by exact vendor root and rejects absent or relative hook context", async () => {
    await savePluginContext("codex", "one", "/project/one");
    await savePluginContext("codex", "two", "/project/two");
    expect(await pluginContext("codex", "one")).toBe("/project/one");
    await expect(savePluginContext("codex", "one", "/subagent/worktree")).rejects.toThrow("Conflicting project context");
    expect(await pluginContext("codex", "one")).toBe("/project/one");
    expect(await pluginContext("codex", "two")).toBe("/project/two");
    await expect(pluginContext("claude-code", "one")).rejects.toThrow("Project context unavailable");
    await expect(savePluginContext("codex", "three", ".")).rejects.toThrow();
  });
  it("retains observed Claude registration privately and refuses missing or stale parents", async () => {
    await savePluginContext("claude-code", "root-one", "/project/one");
    await saveClaudeRegistration({ client: "hook", protocol_version: 1, vendor: "claude-code", vendor_session_id: "root-one", pid: 99999999, ppid: process.pid, cwd: "/project/one", token: "private-vendor-token" });
    const saved = await claudeRegistration("root-one");
    expect(saved.ppid).toBe(process.pid);
    expect(saved.token).toBe("private-vendor-token");
    await expect(claudeRegistration("different-root")).rejects.toThrow("unavailable or expired");
    await saveClaudeRegistration({ client: "hook", protocol_version: 1, vendor: "claude-code", vendor_session_id: "expired-root", pid: 99999999, ppid: 99999998, cwd: "/project/one" });
    await expect(claudeRegistration("expired-root")).rejects.toThrow("unavailable or expired");
  });
  it("refreshes an observed resumed Claude owner only after the previous process exits", async () => {
    await savePluginContext("claude-code", "resumed", "/project/one");
    const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    if (!owner.pid) throw new Error("missing fixture PID");
    const hello = { client: "hook" as const, protocol_version: 1, vendor: "claude-code" as const, vendor_session_id: "resumed", pid: 99999999, ppid: owner.pid, cwd: "/project/one" };
    try {
      await saveClaudeRegistration(hello);
      await expect(saveClaudeRegistration({ ...hello, ppid: process.pid })).rejects.toThrow("Conflicting live Claude owner");
    } finally { owner.kill(); await new Promise<void>(resolve => owner.once("exit", () => resolve())); }
    await saveClaudeRegistration({ ...hello, ppid: process.pid });
    expect((await claudeRegistration("resumed")).ppid).toBe(process.pid);
  });
  it("never uses inherited Claude identity for unknown or Codex clients", () => {
    const previous = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = "inherited";
    try { for (const name of ["codex", "unknown"]) expect(shimHello({ name }).vendor_session_id).toBeUndefined(); }
    finally { if (previous === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = previous; }
  });
});
