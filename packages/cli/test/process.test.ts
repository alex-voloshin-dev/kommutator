import { expectHookProcessTime } from "./hook-timing.js";
import { readHookObservations } from "../src/hook-observations.js";
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function hook(input: string | undefined, args: string[] = []) {
  const home = await mkdtemp(join(tmpdir(), "kom-process-")); dirs.push(home);
  const start = performance.now();
  return await new Promise<{ code: number | null; stdout: string; elapsed: number; home: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "hook", "Stop", ...args], { env: { ...process.env, KOM_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (text) => { stdout += String(text); });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, elapsed: performance.now() - start, home }));
    if (input !== undefined) child.stdin.end(input);
  });
}

describe("production entrypoints", () => {
  it("allows root Codex diagnostics against a legacy daemon but rejects forks before IPC", async () => {
    const home = await mkdtemp(join(tmpdir(), "kom-codex-status-")); dirs.push(home);
    const calls: { method: string; params?: unknown }[] = [];
    const daemon = createServer(socket => {
      let buffer = "";
      socket.on("data", chunk => {
        buffer += String(chunk);
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const request = JSON.parse(buffer.slice(0, end));
          buffer = buffer.slice(end + 1);
          calls.push({ method: request.method, params: request.params });
          socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
            result: request.method === "daemon.status" ? { daemon: { version: "0.0.0" } } : { bound: false },
          }) + "\n");
        }
      });
    });
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"],
      env: { KOM_HOME: home, KOM_PLUGIN_PROFILE: "codex" }, stderr: "pipe" });
    const client = new Client({ name: "codex-mcp-client", version: "0.164.0" });
    try {
      await new Promise<void>((resolve, reject) => {
        daemon.once("error", reject);
        daemon.listen(join(home, "agentd.sock"), resolve);
      });
      await client.connect(transport);
      expect((await client.callTool({ name: "status", arguments: {} })).isError).toBe(true);
      expect((await client.callTool({ name: "status", arguments: {},
        _meta: { sessionId: "root", threadId: "fork" } })).isError).toBe(true);
      expect(calls).toEqual([]);
      const result = await client.callTool({ name: "status", arguments: {},
        _meta: { sessionId: "root", threadId: "root" } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ daemon: { version: "0.0.0" }, caller: { state: "unverified" }, health: { state: "degraded" } });
      expect(calls.map(call => call.method)).toEqual(["ipc.hello", "daemon.status"]);
      expect(calls[0]?.params).toMatchObject({ client: "cli" });
    } finally {
      await client.close();
      await new Promise<void>(resolve => daemon.close(() => resolve()));
    }
  });
  it("empty stdin with no daemon exits silently under the temporary 300ms process limit", async () => {
    const result = await hook("");
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expectHookProcessTime(result.elapsed, "Stop empty stdin");
  });
  it("enforces the same budget even when stdin never ends", async () => {
    const result = await hook(undefined);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expectHookProcessTime(result.elapsed, "Stop stalled stdin");
  });
  it("malformed JSON exits successfully without output", async () => {
    expect(await hook("{broken")).toMatchObject({ code: 0, stdout: "" });
  });
  it("keeps the Codex hook deadline and fails open on unsupported vendor arguments", async () => {
    const result = await hook(undefined, ["--vendor", "codex"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expectHookProcessTime(result.elapsed, "Codex Stop stalled stdin");
    expect(await hook('{"session_id":"root"}', ["--vendor", "unknown"])).toMatchObject({ code: 0, stdout: "" });
  });
  it("speaks real MCP stdio and lists messaging and private setup tools without starting the daemon", async () => {
    const home = await mkdtemp(join(tmpdir(), "kom-stdio-")); dirs.push(home);
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"], env: { KOM_HOME: home }, stderr: "pipe" });
    const client = new Client({ name: "test-agent", version: "1" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(16);
    } finally { await client.close(); }
  });
});

it("records interrupted stdin only as an attempted hook, without output or false success", async () => {
  const result = await hook(undefined);
  expect(result).toMatchObject({ code: 0, stdout: "" });
  expectHookProcessTime(result.elapsed, "Stop interrupted stdin observation");
  const observations = await readHookObservations(undefined, result.home);
  expect(observations).toMatchObject([{ event: "Stop", outcome: "attempted" }]);
});
