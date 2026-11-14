import { expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startDaemon, RpcError, type HubTransport } from "@kommutator/agentd";
import { createConformanceHarness } from "@kommutator/hub/testing";
import * as z from "zod";
import { savePluginContext, saveClaudeRegistration, activeClaudeRegistration } from "../src/plugin-context.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const Reply = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.literal("text"), text: z.string() })) });
it.each(["claude-code", "codex"])("keeps warm %s lookup pure through the built production MCP preparation path", async profile => {
  const home = await mkdtemp(join(tmpdir(), "kom-plugin-operation-")); const cwd = join(home, "project"); await mkdir(cwd);
  const oldHome = process.env.KOM_HOME; process.env.KOM_HOME = home;
  const hub = createConformanceHarness(); const remote = hub.connect("host");
  const hubCalls: string[] = [];
  const transport: HubTransport = { connected: true, start() {}, async close() { remote.disconnect(); }, async request(method, params) { hubCalls.push(method); return remote.request(method, params); } };
  const config = { host: "host", hub: "http://localhost:8787", key: "isolated-fixture-key-long" };
  await writeFile(join(home, "config.json"), JSON.stringify(config), { mode: 0o600 });
  const daemon = await startDaemon({ home, config, transport, isAlive: async () => true, sweepMs: 60_000 });
  const ipcCalls: string[] = []; const request = daemon.core.request.bind(daemon.core); let unsupported: number | undefined;
  daemon.core.request = async (peer, method, params) => {
    ipcCalls.push(method);
    if (unsupported !== undefined && method === "daemon.runtime") throw new RpcError(unsupported, unsupported === -32020 ? "session requires ipc.hello from its shim or hook" : "unknown or unavailable IPC method");
    return request(peer, method, params);
  };
  const client = new Client({ name: profile, version: "isolated-production-test" });
  const root = "production-lookup-root";
  try {
    await savePluginContext(profile, root, cwd);
    if (profile === "claude-code") {
      await saveClaudeRegistration({ client: "hook", vendor: "claude-code", vendor_session_id: root, protocol_version: 1, runtime_contract: 4, pid: process.pid, ppid: process.pid, cwd });
      const registration = await activeClaudeRegistration(process.pid, root);
      await daemon.core.request(daemon.core.peer(), "ipc.hello", registration.hello);
    }
    const stdio = new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"], cwd, stderr: "pipe", env: {
      PATH: process.env.PATH ?? "", HOME: home, KOM_HOME: home, KOM_PLUGIN_PROFILE: profile,
      KOM_CLAUDE_OWNER_PID: String(process.pid), CLAUDE_CODE_SESSION_ID: root,
      CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude"),
    } });
    stdio.stderr?.resume(); await client.connect(stdio);
    const metadata = profile === "codex" ? { _meta: { sessionId: root, threadId: root } } : {};
    expect(Reply.parse(await client.callTool({ name: "whoami", arguments: {}, ...metadata })).isError).not.toBe(true);
    const record = daemon.core.registry.all().find(record => record.session.vendor_session_id === root);
    if (!record) throw new Error("missing warm registered owner");
    // A side-effectful preflight would flush this already admitted sentinel.
    daemon.core.registry.enqueue(record.key, "receipt.mark", { ids: ["sentinel-message"], state: "read" }, Date.now());
    const queued = daemon.core.registry.outbox(); const before = daemon.core.registry.all(); ipcCalls.length = 0; hubCalls.length = 0;
    const result = Reply.parse(await client.callTool({ name: "operation_status", arguments: { operation_id: randomUUID() }, ...metadata }));
    expect(result.isError).not.toBe(true);
    expect(ipcCalls).toEqual(["ipc.hello", "daemon.runtime", "operation.status"]);
    expect(hubCalls).toEqual([]); expect(daemon.core.registry.outbox()).toEqual(queued); expect(daemon.core.registry.all()).toEqual(before);
    for (const code of [-32020, -32601]) {
      unsupported = code; ipcCalls.length = 0;
      const rejected = Reply.parse(await client.callTool({ name: "operation_status", arguments: { operation_id: randomUUID() }, ...metadata }));
      expect(rejected.isError).toBe(true);
      const error = JSON.parse(rejected.content[0]?.text ?? "{}");
      expect(error).toMatchObject({ outcome: "unknown", error: code === -32020 ? "runtime-incompatible" : "local-daemon-upgrade-required" });
      expect(error.guidance).toContain("setup_status");
      expect(error.guidance).not.toContain("bin/manage daemon restart");
      expect(error.guidance).not.toContain("Upgrade and restart the local daemon");
      expect(ipcCalls).toEqual(["ipc.hello", "daemon.runtime"]); expect(hubCalls).toEqual([]);
      expect(daemon.core.registry.outbox()).toEqual(queued);
    }
  } finally {
    await client.close(); await daemon.close(); hub.close();
    if (oldHome === undefined) delete process.env.KOM_HOME; else process.env.KOM_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  }
});
