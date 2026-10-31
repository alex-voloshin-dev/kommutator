import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { PROTOCOL_VERSION } from "@kommutator/protocol";
import { runDoctor, readStatus } from "../src/doctor.js";
import { mergeClaudeHooks, mergeCodexHooks } from "../src/init.js";

const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const key = "doctor-test-key-must-not-appear";
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kom-doc-")); dirs.push(home);
  const bin = join(home, "bin"); await mkdir(bin);
  await writeFile(join(bin, "kom"), "#!/usr/bin/env node\nthrow new Error('must never execute')\n", { mode: 0o700 });
  await writeFile(join(home, "config.json"), JSON.stringify({ host: "mac", hub: "http://127.0.0.1:8787", key }));
  const claudeSettings = join(home, "claude.json");
  await writeFile(claudeSettings, JSON.stringify(mergeClaudeHooks({})));
  const codexHooks = join(home, "codex.json");
  const client = { call: vi.fn(async () => ({ claude_sessions: [{ id: "registered", endpoint_configured: true, socket_present: true }] })), close: vi.fn() };
  const fetchProbe = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ protocol_version: PROTOCOL_VERSION, hosts: [], sessions: [], deliveries: [] })));
  return { home, bin, claudeSettings, codexHooks, client, fetchProbe,
    options: { home, cwd: home, userHome: home, claudeSettings, codexHooks, platform: "darwin" as const, env: { PATH: bin }, timeoutMs: 500 },
    probes: { client: () => client, fetch: fetchProbe, guiPath: async () => bin },
  };
}

describe("read-only doctor", () => {
  it("checks current PATH, hook configuration, IPC, sockets and authenticated hub without executing or mutating", async () => {
    const f = await fixture();
    const before = await readdir(f.home);
    const result = await runDoctor(f.options, f.probes);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(false);
    for (const id of ["config", "host", "path.current", "hooks.claude", "ipc", "sockets.claude", "hub"]) expect(result.checks.find((check) => check.id === id)?.state).toBe("pass");
    expect(result.checks.find((check) => check.id === "path.gui")).toMatchObject({ state: "warning", summary: expect.stringContaining("Node interpreter") });
    expect(result.checks.find((check) => check.id === "hooks.codex")?.state).toBe("not_configured");
    expect(f.fetchProbe).toHaveBeenCalledWith(new URL("http://127.0.0.1:8787/api/snapshot"), expect.objectContaining({ headers: { authorization: `Bearer ${key}` }, redirect: "error" }));
    expect(f.client.call).toHaveBeenCalledExactlyOnceWith("daemon.diagnostics");
    expect(f.client.close).toHaveBeenCalledOnce();
    expect(await readdir(f.home)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("does not claim shell PATH proves the GUI environment when launchd PATH is absent", async () => {
    const f = await fixture();
    const result = await runDoctor(f.options, { ...f.probes, guiPath: async () => undefined });
    expect(result.checks.find((check) => check.id === "path.current")?.state).toBe("pass");
    expect(result.checks.find((check) => check.id === "path.gui")?.state).toBe("unknown");
    await chmod(join(f.bin, "kom"), 0o600);
    const missing = await runDoctor(f.options, f.probes);
    expect(missing.ok).toBe(false);
    expect(missing.checks.find((check) => check.id === "path.current")?.state).toBe("fail");
  });

  it("distinguishes absent and invalid config without revealing values or requesting the hub", async () => {
    const f = await fixture();
    await writeFile(join(f.home, "config.json"), JSON.stringify({ key, host: "bad.host", hub: "bad-url-containing-secret" }));
    const invalid = await runDoctor(f.options, f.probes);
    expect(invalid.checks.find((check) => check.id === "config")?.state).toBe("fail");
    expect(invalid.checks.find((check) => check.id === "host")?.state).toBe("fail");
    expect(f.fetchProbe).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid)).not.toContain("bad-url-containing-secret");
    await rm(join(f.home, "config.json"));
    const absent = await runDoctor(f.options, f.probes);
    expect(absent.checks.find((check) => check.id === "config")?.state).toBe("not_configured");
  });

  it("reports missing, inaccessible and absent registered sockets without showing endpoints", async () => {
    const f = await fixture();
    for (const [sessions, expected] of [
      [[], "not_configured"],
      [[{ id: "a", endpoint_configured: false, socket_present: null }], "fail"],
      [[{ id: "a", endpoint_configured: true, socket_present: false }], "fail"],
      [[{ id: "a", endpoint_configured: true, socket_present: null }], "unknown"],
    ] as const) {
      const client = { call: async () => ({ claude_sessions: sessions }), close: vi.fn() };
      const result = await runDoctor(f.options, { ...f.probes, client: () => client });
      expect(result.checks.find((check) => check.id === "sockets.claude")?.state).toBe(expected);
    }
  });

  it("closes a stalled IPC request at its deadline and sanitizes other failing probes", async () => {
    const f = await fixture();
    const client = { call: () => new Promise<never>(() => {}), close: vi.fn() };
    const fetchProbe = vi.fn<typeof fetch>(async () => { throw new Error(`request to secret-endpoint with ${key}`); });
    const result = await runDoctor({ ...f.options, timeoutMs: 50 }, { ...f.probes, client: () => client, fetch: fetchProbe });
    expect(client.close).toHaveBeenCalledOnce();
    expect(result.checks.find((check) => check.id === "ipc")?.state).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain("secret-endpoint");
  });

  it("handles HTTP auth, protocol mismatch and large responses without exposing bodies", async () => {
    const f = await fixture();
    for (const [response, state] of [
      [new Response(key, { status: 401 }), "fail"],
      [new Response(JSON.stringify({ protocol_version: -1, hosts: [], sessions: [], deliveries: [] })), "warning"],
      [new Response("x".repeat(1_048_577)), "warning"],
      [new Response(key), "fail"],
    ] as const) {
      const result = await runDoctor(f.options, { ...f.probes, fetch: async () => response });
      expect(result.checks.find((check) => check.id === "hub")?.state).toBe(state);
      expect(JSON.stringify(result)).not.toContain(key);
    }
  });

  it("aborts a stalled authenticated HTTP response body and closes IPC at the deadline", async () => {
    const f = await fixture();
    let headersSent = false;
    let responseClosed = false;
    let authenticated = false;
    const server = createServer((request, response) => {
      authenticated = request.headers.authorization === `Bearer ${key}`;
      response.once("close", () => { responseClosed = true; });
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      response.write('{"protocol_version":');
      headersSent = true;
      // Deliberately leave the body open; the doctor's AbortSignal must end this read.
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing HTTP fixture port");
      await writeFile(join(f.home, "config.json"), JSON.stringify({ host: "mac", hub: `http://127.0.0.1:${address.port}`, key }));
      const started = performance.now();
      const result = await runDoctor({ ...f.options, timeoutMs: 200 }, { client: () => f.client, guiPath: f.probes.guiPath });
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(headersSent).toBe(true);
      expect(authenticated).toBe(true);
      // The shared deadline and fetch abort can race; neither may report a pass.
      expect(["fail", "unknown"]).toContain(result.checks.find((check) => check.id === "hub")?.state);
      await expect.poll(() => responseClosed, { timeout: 1_000, interval: 10 }).toBe(true);
      expect(f.client.close).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain(key);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("does not request an embedded-credential hub URL", async () => {
    const f = await fixture();
    await writeFile(join(f.home, "config.json"), JSON.stringify({ host: "mac", hub: `http://user:${key}@127.0.0.1`, key }));
    const result = await runDoctor(f.options, f.probes);
    expect(result.checks.find((check) => check.id === "hub")?.state).toBe("fail");
    expect(f.fetchProbe).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("inspects default project hook files and flags disabled or partial configurations", async () => {
    const f = await fixture();
    await mkdir(join(f.home, ".claude"));
    await writeFile(join(f.home, ".claude", "settings.local.json"), JSON.stringify(mergeClaudeHooks({})));
    const { claudeSettings: _explicit, ...options } = f.options;
    expect((await runDoctor(options, f.probes)).checks.find((check) => check.id === "hooks.claude")?.state).toBe("pass");
    await writeFile(f.claudeSettings, JSON.stringify({ disableAllHooks: true }));
    expect((await runDoctor(f.options, f.probes)).checks.find((check) => check.id === "hooks.claude")?.state).toBe("warning");
    await writeFile(f.claudeSettings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "kom", args: ["hook", "Stop"] }] }] } }));
    expect((await runDoctor(f.options, f.probes)).checks.find((check) => check.id === "hooks.claude")?.summary).toContain("Missing hook commands");
  });

  it("validates an explicit Claude plugin without asserting that it is active or globally installed", async () => {
    const f = await fixture();
    await rm(f.claudeSettings);
    const pluginDir = join(f.home, "plugin");
    await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
    await mkdir(join(pluginDir, "hooks"));
    await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "kommutator", mcpServers: { kommutator: { command: "kom", args: ["mcp"] } } }));
    await writeFile(join(pluginDir, "hooks", "hooks.json"), JSON.stringify(mergeClaudeHooks({})));
    const result = await runDoctor({ ...f.options, pluginDir }, f.probes);
    expect(result.checks.find((check) => check.id === "hooks.claude")?.state).toBe("not_configured");
    expect(result.checks.find((check) => check.id === "plugin.claude")).toMatchObject({ state: "warning", summary: expect.stringContaining("does not establish installation") });
    expect(await readFile(join(pluginDir, "hooks", "hooks.json"), "utf8")).toBe(JSON.stringify(mergeClaudeHooks({})));
  });

  it("never treats configured Codex hook entries as verified runtime support", async () => {
    const f = await fixture();
    await writeFile(f.codexHooks, JSON.stringify(mergeCodexHooks({})));
    expect((await runDoctor(f.options, f.probes)).checks.find((check) => check.id === "hooks.codex")).toMatchObject({ state: "warning", summary: expect.stringContaining("still require a live") });
  });

  it("separates Codex registration, liveness and observed hook polls", async () => {
    const f = await fixture();
    for (const [sessions, state] of [
      [[], "not_configured"],
      [[{ id: "root", shim_alive: false, hook_events: [] }], "fail"],
      [[{ id: "root", shim_alive: true, hook_events: [] }], "warning"],
      [[{ id: "root", shim_alive: true, hook_events: ["PostToolUse", "Stop"] }], "pass"],
    ] as const) {
      const client = { call: async () => ({ claude_sessions: [], codex_sessions: sessions }), close() {} };
      const result = await runDoctor(f.options, { ...f.probes, client: () => client });
      expect(result.checks.find((entry) => entry.id === "runtime.codex")?.state).toBe(state);
    }
  });

  it("recognizes absolute exec-form kom and built CLI paths and identifies missing executables", async () => {
    const f = await fixture();
    const built = join(f.home, "packages", "cli", "dist", "index.js");
    await mkdir(join(f.home, "packages", "cli", "dist"), { recursive: true });
    await writeFile(built, "#!/usr/bin/env node\n", { mode: 0o700 });
    for (const executable of [join(f.bin, "kom"), built]) {
      const hooks = JSON.stringify(mergeClaudeHooks({})).replaceAll('"command":"kom"', `"command":${JSON.stringify(executable)}`);
      await writeFile(f.claudeSettings, hooks);
      expect((await runDoctor(f.options, f.probes)).checks.find((check) => check.id === "hooks.claude")?.state).toBe("pass");
    }
    await rm(built);
    expect((await runDoctor(f.options, f.probes)).checks.find((check) => check.id === "hooks.claude")).toMatchObject({ state: "warning", summary: expect.stringContaining("absolute kom executable is missing") });
  });

  it("does not create daemon files when the real local IPC endpoint is absent", async () => {
    const f = await fixture();
    const result = await runDoctor(f.options, { fetch: f.fetchProbe, guiPath: async () => undefined });
    expect(result.checks.find((check) => check.id === "ipc")?.state).toBe("fail");
    expect(await readdir(f.home)).not.toContain("state.db");
    expect(await readdir(f.home)).not.toContain("agentd.sock");
  });
});

describe("CLI status", () => {
  it("preserves the live JSON result and closes the read-only client", async () => {
    const result = { daemon: { pid: 10 }, hub: { connected: true }, outbox_depth: 0, sessions: [] };
    const client = { call: vi.fn(async () => result), close: vi.fn() };
    expect(await readStatus({}, () => client)).toEqual(result);
    expect(client.call).toHaveBeenCalledExactlyOnceWith("daemon.status");
    expect(client.close).toHaveBeenCalledOnce();
  });

  it("returns actionable, sanitized unavailable state without assuming a timed-out process stopped", async () => {
    const client = { call: async () => { throw new Error(key); }, close: vi.fn() };
    const result = await readStatus({}, () => client);
    expect(result).toMatchObject({ daemon: { running: null }, health: { state: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain(key);
    const absent = { call: async () => { throw Object.assign(new Error("private socket path"), { code: "ENOENT" }); }, close: vi.fn() };
    expect(await readStatus({}, () => absent)).toMatchObject({ daemon: { running: false } });
  });
});
