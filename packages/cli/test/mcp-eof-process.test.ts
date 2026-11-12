import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { phase, withCleanup } from "./fixture-lifecycle.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const Frame = z.object({ id: z.number().optional(), method: z.string().optional(), result: z.unknown().optional() });
const Tool = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ text: z.string() })) });

it.each([false, true])("stdin EOF closes MCP resources with setup pending=%s and preserves another client", async (pendingSetup) => {
  const home = await mkdtemp(join(tmpdir(), "kom-mcp-eof-"));
  const sockets = new Set<Socket>();
  const methods: string[] = [];
  const errors: string[] = [];
  const daemon = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => { if (errors.length < 8) errors.push("fixture socket error"); });
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const frame = Frame.parse(JSON.parse(buffer.slice(0, newline)) as unknown);
        buffer = buffer.slice(newline + 1);
        methods.push(frame.method ?? "missing");
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { bound: true, sessions: [], outbox: [] } }) + "\n");
      }
    });
  });
  const clients: ReturnType<typeof start>[] = [];
  function start(preload?: string) {
    const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), entry, "mcp"], {
      env: { PATH: process.env.PATH ?? "", HOME: home, KOM_HOME: home }, stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const pending = new Map<number, (value: unknown) => void>();
    let id = 0, buffer = "", stderrBytes = 0;
    child.stderr.on("data", chunk => { stderrBytes += chunk.length; });
    child.stdin.on("error", () => { errors.push("fixture stdin error"); });
    child.on("error", () => { errors.push("fixture child error"); });
    child.stdout.on("data", chunk => {
      buffer += String(chunk);
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const frame = Frame.parse(JSON.parse(buffer.slice(0, newline)) as unknown);
        buffer = buffer.slice(newline + 1);
        if (frame.id !== undefined) { pending.get(frame.id)?.(frame.result); pending.delete(frame.id); }
      }
    });
    async function call(method: string, params: unknown) {
      const current = ++id;
      const result = new Promise<unknown>(resolve => pending.set(current, resolve));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n");
      try { return await phase(`raw MCP ${method}`, () => result, 3000); }
      finally { pending.delete(current); }
    }
    return { child, exited, call, stderrBytes: () => stderrBytes };
  }
  await withCleanup(async () => {
    await new Promise<void>(resolve => daemon.listen(join(home, "agentd.sock"), resolve));
    const preload = join(home, "pause-setup.mjs");
    if (pendingSetup) await writeFile(preload, `
      import fs from "node:fs/promises";
      import { writeFileSync, existsSync } from "node:fs";
      import { join } from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      const home = process.env.KOM_HOME;
      const access = fs.access;
      fs.access = async function(path, ...args) {
        if (String(path) === join(home, "config.json")) {
          writeFileSync(join(home, "setup-paused"), "");
          await new Promise(resolve => {
            const timer = setInterval(() => {
              if (existsSync(join(home, "release-setup"))) { clearInterval(timer); resolve(); }
            }, 10);
          });
        }
        return access.call(this, path, ...args);
      };
      process.stdin.once("end", () => writeFileSync(join(home, "stdin-ended"), ""));
      syncBuiltinESMExports();
    `);
    for (let index = 0; index < 2; index++) {
      const client = start(pendingSetup && index === 0 ? preload : undefined); clients.push(client);
      await client.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
      client.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const status = Tool.parse(await client.call("tools/call", { name: "status", arguments: {} }));
      expect(status.isError).not.toBe(true);
    }
    const first = clients[0]!, second = clients[1]!;
    expect(sockets.size).toBe(2);
    let url: string | undefined;
    if (pendingSetup) {
      first.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "setup_start", arguments: {} } }) + "\n");
      await expect.poll(async () => stat(join(home, "setup-paused")).then(() => true, () => false)).toBe(true);
    } else {
      const setup = Tool.parse(await first.call("tools/call", { name: "setup_start", arguments: {} }));
      url = z.object({ url: z.string().url() }).parse(JSON.parse(setup.content[0]!.text) as unknown).url;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      await response.text();
    }
    first.child.stdin.end();
    if (pendingSetup) {
      await expect.poll(async () => stat(join(home, "stdin-ended")).then(() => true, () => false)).toBe(true);
      await writeFile(join(home, "release-setup"), "");
    }
    expect(await phase("natural EOF exit", () => first.exited, 1500)).toEqual({ code: 0, signal: null });
    await expect.poll(() => sockets.size).toBe(1);
    if (url) await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    expect(Tool.parse(await second.call("tools/call", { name: "status", arguments: {} })).isError).not.toBe(true);
    expect(daemon.listening).toBe(true);
    expect(methods).not.toContain("daemon.shutdown");
    second.child.stdin.end();
    expect(await phase("second natural EOF exit", () => second.exited, 1500)).toEqual({ code: 0, signal: null });
    expect(clients.map(client => client.stderrBytes())).toEqual([0, 0]);
    expect(errors).toEqual([]);
  }, async () => {
    for (const client of clients) {
      if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill("SIGKILL");
      await phase("owned MCP cleanup", () => client.exited, 2000);
    }
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => daemon.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
}, 15000);
