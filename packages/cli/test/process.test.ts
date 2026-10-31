import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
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
  return await new Promise<{ code: number | null; stdout: string; elapsed: number }>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "hook", "Stop", ...args], { env: { ...process.env, KOM_HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (text) => { stdout += String(text); });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, elapsed: performance.now() - start }));
    if (input !== undefined) child.stdin.end(input);
  });
}

describe("production entrypoints", () => {
  it("empty stdin with no daemon exits silently under the 200ms total budget", async () => {
    const result = await hook("");
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.elapsed).toBeLessThan(200);
  });
  it("enforces the same budget even when stdin never ends", async () => {
    const result = await hook(undefined);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.elapsed).toBeLessThan(200);
  });
  it("malformed JSON exits successfully without output", async () => {
    expect(await hook("{broken")).toMatchObject({ code: 0, stdout: "" });
  });
  it("keeps the Codex hook deadline and fails open on unsupported vendor arguments", async () => {
    const result = await hook(undefined, ["--vendor", "codex"]);
    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(result.elapsed).toBeLessThan(200);
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
