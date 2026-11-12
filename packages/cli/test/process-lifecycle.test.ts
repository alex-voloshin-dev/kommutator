import { expectHookProcessTime } from "./hook-timing.js";
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHubServer } from "@kommutator/hub";
import { openDatabase } from "@kommutator/hub/db";
import { PROTOCOL_VERSION, RegisteredSession } from "@kommutator/protocol";
import { IpcClient } from "../src/ipc-client.js";
import { readHookObservations } from "../src/hook-observations.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ToolReply = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
});
const DaemonInfo = z.object({ pid: z.number().int().positive(), endpoint: z.string(), started_at: z.string() });
const Whoami = z.object({ session: RegisteredSession });

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function staleSocket(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // SIGKILL leaves a real stale Unix socket, unlike a graceful net.Server.close().
    const child = spawn(process.execPath, ["--input-type=module", "--eval",
      "import { createServer } from 'node:net'; createServer().listen(process.argv[1], () => process.stdout.write('ready'));",
      path], { stdio: ["ignore", "pipe", "pipe"] });
    let ready = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("stale socket fixture timed out")); }, 3_000);
    child.stdout.once("data", () => { ready = true; child.kill("SIGKILL"); });
    child.stderr.resume();
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (_code, signal) => {
      clearTimeout(timer);
      if (ready && signal === "SIGKILL") resolve();
      else reject(new Error("stale socket fixture exited before listening"));
    });
  });
  expect((await stat(path)).isSocket()).toBe(true);
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kom-lifecycle-"));
  const cwd = join(home, "project");
  await mkdir(cwd);
  const db = openDatabase(":memory:");
  const hub = createHubServer({ db, key: "process-lifecycle-test-key" });
  const clients: Client[] = [];
  const inboxes: Server[] = [];
  let daemon: z.infer<typeof DaemonInfo> | undefined;
  const environment = {
    PATH: process.env.PATH ?? "",
    KOM_HOME: home,
    KOM_PROJECT: "process-lifecycle",
    CLAUDE_CODE_SESSION_ID: "",
    CLAUDE_CODE_MESSAGING_SOCKET: "",
  };

  async function daemonInfo() {
    const value: unknown = JSON.parse(await readFile(join(home, "agentd.json"), "utf8"));
    daemon = DaemonInfo.parse(value);
    expect(daemon.endpoint).toBe(join(home, "agentd.sock"));
    return daemon;
  }

  async function close() {
    const failures: unknown[] = [];
    for (const client of clients) {
      try { await client.close(); } catch (error) { failures.push(error); }
    }
    // This endpoint and PID file exist only inside this fixture's private directory.
    const management = new IpcClient({
      endpoint: join(home, "agentd.sock"), timeoutMs: 500, lazyStart: false,
      hello: () => ({ client: "cli", protocol_version: PROTOCOL_VERSION, pid: process.pid, cwd }),
    });
    try { await management.call("daemon.shutdown"); }
    catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT" && code !== "ECONNREFUSED") failures.push(error);
    } finally { management.close(); }
    if (!daemon) {
      try { await daemonInfo(); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) failures.push(error);
      }
    }
    if (daemon) {
      const ownedPid = daemon.pid;
      try { await expect.poll(() => isRunning(ownedPid), { timeout: 2_000, interval: 25 }).toBe(false); }
      catch (error) {
        failures.push(error);
        // Only the daemon identified by this fixture's private startup record is signalled.
        if (isRunning(ownedPid)) process.kill(ownedPid, "SIGTERM");
        await expect.poll(() => isRunning(ownedPid), { timeout: 2_000, interval: 25 }).toBe(false);
      }
    }
    for (const inbox of inboxes) {
      try { await closeServer(inbox); } catch (error) { failures.push(error); }
    }
    try {
      if (hub.listening) await new Promise<void>((resolve, reject) => hub.close((error) => error ? reject(error) : resolve()));
    } catch (error) { failures.push(error); }
    db.close();
    await rm(home, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, "process fixture cleanup failed");
  }

  try {
    await new Promise<void>((resolve, reject) => {
      hub.once("error", reject);
      hub.listen(0, "127.0.0.1", () => { hub.off("error", reject); resolve(); });
    });
    const address = hub.address();
    if (!address || typeof address === "string") throw new Error("missing test hub port");
    await writeFile(join(home, "config.json"), JSON.stringify({
      hub: `http://127.0.0.1:${address.port}`, key: "process-lifecycle-test-key", host: "fixture-mac",
    }), { mode: 0o600 });
  } catch (error) { await close(); throw error; }

  return {
    home, cwd, db, close, daemonInfo,
    async shim(vendorId?: string) {
      const transport = new StdioClientTransport({
        command: process.execPath, args: [entry, "mcp"], cwd, stderr: "pipe",
        env: { ...environment, CLAUDE_CODE_SESSION_ID: vendorId ?? "",
          // Without an ID, identify the vendor while exercising the documented fallback.
          CLAUDE_CODE_MESSAGING_SOCKET: join(home, "unclaimed.sock") },
      });
      transport.stderr?.on("data", () => { /* Drain diagnostics without polluting MCP stdout. */ });
      const client = new Client({ name: "claude-code-fixture", version: "test" });
      clients.push(client);
      await client.connect(transport);
      return { client, transport };
    },
    async register(vendorId: string, name: string) {
      const endpoint = join(home, `${name}.sock`);
      const inbox = createServer((socket) => { socket.end(); });
      inboxes.push(inbox);
      await new Promise<void>((resolve, reject) => {
        inbox.once("error", reject);
        inbox.listen(endpoint, () => { inbox.off("error", reject); resolve(); });
      });
      const started = performance.now();
      const result = await new Promise<{ code: number | null; stdout: string; elapsed: number }>((resolve, reject) => {
        const child = spawn(process.execPath, [entry, "hook", "SessionStart"], {
          cwd, env: { ...environment, CLAUDE_CODE_SESSION_ID: vendorId, CLAUDE_CODE_MESSAGING_SOCKET: endpoint },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("SessionStart fixture timed out")); }, 3_000);
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.resume();
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, elapsed: performance.now() - started }); });
        child.stdin.end(JSON.stringify({ session_id: vendorId, cwd, permission_mode: "default" }));
      });
      expect({ code: result.code, stdout: result.stdout }).toEqual({ code: 0, stdout: "" });
      const observations = (await readHookObservations(vendorId, home)).map(({ event, outcome, at }) => ({ event, outcome, at }));
      return { ...result, vendorId, observations };
    },
  };
}

async function whoami(client: Client, failureContext?: () => string) {
  const reply = ToolReply.parse(await client.callTool({ name: "whoami", arguments: {} }));
  expect(reply.isError, reply.isError ? `${reply.content[0]?.text}\n${failureContext?.() ?? ""}` : undefined).not.toBe(true);
  const text = reply.content[0]?.text;
  if (!text) throw new Error("whoami returned no text");
  const value: unknown = JSON.parse(text);
  return Whoami.parse(value).session;
}

describe("built CLI process lifecycle with fake vendor sessions (not live vendor E2E)", () => {
  it("does not mistake a rejected hook's fail-open exit for successful registration", async () => {
    const setup = await fixture();
    const sockets = new Set<import("node:net").Socket>();
    let hellos = 0;
    const listener = createServer(socket => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      let buffer = "";
      socket.on("data", chunk => {
        buffer += String(chunk);
        let end: number;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const frame = z.object({ id: z.number(), method: z.string() }).parse(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
          if (frame.method === "ipc.hello") hellos++;
          socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id,
            error: { code: -32020, message: "Synthetic process ownership unavailable" } }) + "\n");
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(join(setup.home, "agentd.sock"), () => { listener.off("error", reject); resolve(); });
      });
      const hook = await setup.register("fixture-rejected", "rejected");
      expect({ code: hook.code, stdout: hook.stdout }).toEqual({ code: 0, stdout: "" });
      expect(hellos).toBe(1);
      expect(hook.observations).toEqual([expect.objectContaining({ event: "SessionStart", outcome: "failed" })]);
      expect(setup.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    } finally {
      for (const socket of sockets) socket.destroy();
      await closeServer(listener);
      await setup.close();
    }
  }, 10_000);

  it("returns a valid cold SessionStart within the temporary 300ms process limit and leaves its detached daemon running", async () => {
    const setup = await fixture();
    try {
      const hook = await setup.register("fixture-cold-start", "cold-start");
      expectHookProcessTime(hook.elapsed, "configured cold SessionStart");
      await expect.poll(async () => {
        try { return (await setup.daemonInfo()).pid; } catch { return undefined; }
      }, { timeout: 5_000, interval: 25 }).toBeTypeOf("number");
      const daemon = await setup.daemonInfo();
      expect(isRunning(daemon.pid)).toBe(true);
    } finally { await setup.close(); }
  }, 10_000);

  it.each(["absent", "stale"] as const)("shares one daemon from an initially %s socket and survives the first shim exiting", async (initial) => {
    const setup = await fixture();
    try {
      if (initial === "stale") await staleSocket(join(setup.home, "agentd.sock"));
      const [first, second] = await Promise.all([setup.shim("fixture-author"), setup.shim("fixture-reviewer")]);
      // Both calls fail to connect and may race to spawn the detached singleton.
      const pending = await Promise.all([first.client, second.client].map((client) => client.callTool({ name: "whoami", arguments: {} })));
      for (const reply of pending) expect(ToolReply.parse(reply).isError).toBe(true);
      await expect.poll(async () => {
        try { return (await setup.daemonInfo()).pid; } catch { return undefined; }
      }, { timeout: 5_000, interval: 25 }).toBeTypeOf("number");
      const initialDaemon = await setup.daemonInfo();
      expect(isRunning(initialDaemon.pid)).toBe(true);
      expect(initialDaemon.pid).not.toBe(first.transport.pid);
      expect(initialDaemon.pid).not.toBe(second.transport.pid);

      const authorHook = await setup.register("fixture-author", "author");
      const reviewerHook = await setup.register("fixture-reviewer", "reviewer");
      const diagnostic = (hook: typeof authorHook) => () => JSON.stringify({
        vendorId: hook.vendorId, hookElapsedMs: hook.elapsed, hookObservations: hook.observations,
        hubSessions: setup.db.prepare("SELECT vendor_session_id, state FROM sessions ORDER BY vendor_session_id").all(),
      });
      const [author, reviewer] = await Promise.all([
        whoami(first.client, diagnostic(authorHook)), whoami(second.client, diagnostic(reviewerHook)),
      ]);
      expect(author.vendor_session_id).toBe("fixture-author");
      expect(reviewer.vendor_session_id).toBe("fixture-reviewer");
      expect(author.cwd).toBe(setup.cwd);
      expect(reviewer.cwd).toBe(setup.cwd);
      expect(author.id).not.toBe(reviewer.id);
      expect(author.handle).not.toBe(reviewer.handle);
      expect(setup.db.prepare("SELECT id, vendor_session_id FROM sessions ORDER BY vendor_session_id").all()).toEqual([
        { id: author.id, vendor_session_id: "fixture-author" },
        { id: reviewer.id, vendor_session_id: "fixture-reviewer" },
      ]);

      const ambiguous = await setup.shim();
      const error = ToolReply.parse(await ambiguous.client.callTool({ name: "whoami", arguments: {} }));
      expect(error.isError).toBe(true);
      expect(error.content[0]?.text).toMatch(/ambiguous/i);
      expect(setup.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 2 });

      const firstPid = first.transport.pid;
      expect(firstPid).not.toBeNull();
      await first.client.close();
      if (firstPid !== null) expect(isRunning(firstPid)).toBe(false);
      expect(await setup.daemonInfo()).toEqual(initialDaemon);
      expect(isRunning(initialDaemon.pid)).toBe(true);
      expect(await whoami(second.client)).toEqual(reviewer);
      const status = ToolReply.parse(await second.client.callTool({ name: "status", arguments: {} }));
      expect(status.isError).not.toBe(true);
    } finally { await setup.close(); }
  }, 20_000);
});
