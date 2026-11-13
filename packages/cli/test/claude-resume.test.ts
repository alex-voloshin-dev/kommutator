import { afterEach, beforeEach, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeClaudeRegistration, saveClaudeRegistration, forgetClaudeRegistration } from "../src/plugin-context.js";
import { ClaudePluginClient } from "../src/claude.js";
import { IpcError, type Hello, type RpcClient } from "../src/ipc-client.js";
let home: string;
const oldHome = process.env.KOM_HOME;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "kom-resume-")); process.env.KOM_HOME = home; });
afterEach(async () => { if (oldHome === undefined) delete process.env.KOM_HOME; else process.env.KOM_HOME = oldHome; await rm(home, { recursive: true, force: true }); });
const hello = (id: string): Hello => ({ client: "hook", protocol_version: 1, runtime_contract: 4, vendor: "claude-code", vendor_session_id: id, pid: process.pid, ppid: process.pid, cwd: "/project" });

it("resolves the hook's current conversation despite stale or absent launch identity", async () => {
  await saveClaudeRegistration(hello("A"));
  const a = await activeClaudeRegistration(process.pid, "A");
  await saveClaudeRegistration(hello("B"));
  const b = await activeClaudeRegistration(process.pid, "A");
  expect(b.hello.vendor_session_id).toBe("B");
  expect((await activeClaudeRegistration(process.pid)).generation).toBe(b.generation);
  await forgetClaudeRegistration("A", process.pid);
  expect((await activeClaudeRegistration(process.pid, "A")).generation).toBe(b.generation);
  await saveClaudeRegistration(hello("A"));
  const resumed = await activeClaudeRegistration(process.pid, "A");
  expect(resumed.generation).not.toBe(a.generation);
  expect(resumed.generation).not.toBe(b.generation);
});

it("requires committed current authority and rejects missing, ended or malformed journals", async () => {
  await saveClaudeRegistration(hello("A"));
  const directoryName = (await readdir(join(home, "contexts"))).find(name => name.endsWith(".d"));
  if (!directoryName) throw new Error("missing active fixture");
  const directory = join(home, "contexts", directoryName);
  const original = await readFile(join(directory, "1.json"), "utf8");
  await rm(directory, { recursive: true });
  await expect(activeClaudeRegistration(process.pid, "A")).rejects.toThrow("unavailable or expired");
  await expect(activeClaudeRegistration(process.pid, "B")).rejects.toThrow("unavailable or expired");
  await saveClaudeRegistration(hello("A"));
  await writeFile(join(directory, "1.json"), "malformed");
  await expect(activeClaudeRegistration(process.pid, "A")).rejects.toThrow("unavailable or expired");
  await writeFile(join(directory, "1.json"), original);
  await saveClaudeRegistration(hello("B"));
  await forgetClaudeRegistration("B", process.pid);
  await expect(activeClaudeRegistration(process.pid, "A")).rejects.toThrow("unavailable or expired");
});

it("routes a long-lived MCP client through fresh immutable IPC connections after A to B to A", async () => {
  const calls: string[] = [], closed: string[] = [];
  const client = new ClaudePluginClient({
    resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {},
    shim(observed) { const id = observed.vendor_session_id ?? "missing"; return { close() { closed.push(id); }, async call(method) { calls.push(`${id}:${method}`); return id; } }; },
    hook() { throw new Error("already registered"); },
  });
  for (const id of ["A", "B", "A"]) { await saveClaudeRegistration(hello(id)); expect(await client.call("session.upsert", { status_line: id })).toBe(id); }
  expect(calls.filter(call => call.endsWith(":session.upsert"))).toEqual(["A:session.upsert", "B:session.upsert", "A:session.upsert"]);
  expect(closed).toEqual(["A", "B"]);
  client.close();
});

it("fails closed when resume races asynchronous preflight and does not dispatch a mutation", async () => {
  await saveClaudeRegistration(hello("A"));
  let calls = 0;
  const rpc: RpcClient = { close() {}, async call() { calls++; return {}; } };
  const client = new ClaudePluginClient({ resolve: () => activeClaudeRegistration(process.pid, "A"),
    prepare: async () => { await saveClaudeRegistration(hello("B")); }, shim: () => rpc, hook: () => rpc });
  await expect(client.call("message.send")).rejects.toThrow("conversation changed");
  expect(calls).toBe(0);
});

it("never retries an already dispatched mutation if the conversation changes before its reply", async () => {
  await saveClaudeRegistration(hello("A"));
  let sent = 0;
  const rpc: RpcClient = { close() {}, async call(method) { if (method === "message.send") { sent++; await saveClaudeRegistration(hello("B")); } return {}; } };
  const client = new ClaudePluginClient({ resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {}, shim: () => rpc, hook: () => rpc });
  await expect(client.call("message.send")).rejects.toThrow("inspect its outcome");
  expect(sent).toBe(1);
});

it("a delayed SessionEnd tombstones only its captured generation after A to B to A", async () => {
  await saveClaudeRegistration(hello("A"));
  const first = await activeClaudeRegistration(process.pid);
  await saveClaudeRegistration(hello("B"));
  await saveClaudeRegistration(hello("A"));
  const latest = await activeClaudeRegistration(process.pid);
  await forgetClaudeRegistration("A", process.pid, first);
  expect((await activeClaudeRegistration(process.pid)).generation).toBe(latest.generation);
});

it("opens a new shim after hook recovery rather than reusing the retired peer", async () => {
  await saveClaudeRegistration(hello("A"));
  const calls: string[] = [];
  let shims = 0;
  const client = new ClaudePluginClient({
    resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {},
    shim() {
      const id = ++shims;
      return { close() { calls.push(`close:${id}`); }, async call(method) {
        calls.push(`shim:${id}:${method}`);
        if (id === 1) throw new IpcError("session ended", -32020);
        return { sent: true };
      } };
    },
    hook() { return { close() { calls.push("hook:close"); }, async call(method) { calls.push(`hook:${method}`); return {}; } }; },
  });
  expect(await client.call("message.send", { message: { body: "once" } })).toEqual({ sent: true });
  expect(calls).toEqual(["shim:1:whoami", "hook:whoami", "hook:close", "close:1", "shim:2:message.send"]);
  client.close();
});

it("does not dispatch a mutation if hook recovery overlaps a conversation switch", async () => {
  await saveClaudeRegistration(hello("A"));
  const calls: string[] = [];
  const client = new ClaudePluginClient({
    resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {},
    shim() { return { close() {}, async call(method) { calls.push(method); throw new IpcError("session ended", -32020); } }; },
    hook() { return { close() {}, async call() { await saveClaudeRegistration(hello("B")); return {}; } }; },
  });
  await expect(client.call("message.send")).rejects.toThrow("conversation changed");
  expect(calls).toEqual(["whoami"]);
  client.close();
});

it("does not retry a mutation that fails ambiguously after successful retired-peer recovery", async () => {
  await saveClaudeRegistration(hello("A"));
  const calls: string[] = [];
  let shims = 0;
  const ambiguous = new IpcError("connection lost after write", -32020);
  const client = new ClaudePluginClient({
    resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {},
    shim() {
      const id = ++shims;
      return { close() {}, async call(method) {
        calls.push(`shim:${id}:${method}`);
        if (id === 1) throw new IpcError("session ended", -32020);
        throw ambiguous;
      } };
    },
    hook() { return { close() {}, async call(method) { calls.push(`hook:${method}`); return {}; } }; },
  });
  await expect(client.call("message.send", { message: { body: "at most once" } })).rejects.toBe(ambiguous);
  expect(calls).toEqual(["shim:1:whoami", "hook:whoami", "shim:2:message.send"]);
  client.close();
});

it("looks up an operation locally without whoami or registration recovery and fences generation changes", async () => {
  await saveClaudeRegistration(hello("A"));
  const calls: string[] = [];
  let change = false;
  const client = new ClaudePluginClient({
    resolve: () => activeClaudeRegistration(process.pid, "A"), prepare: async () => {},
    shim: () => ({ close() {}, async call(method) { calls.push(method); if (change) await saveClaudeRegistration(hello("B")); return { outcome: "unknown" }; } }),
    hook() { throw new Error("local lookup must never recover registration"); },
  });
  expect(await client.call("operation.status", { operation_id: "local-id" })).toEqual({ outcome: "unknown" });
  expect(calls).toEqual(["operation.status"]);
  change = true;
  await expect(client.call("operation.status", { operation_id: "local-id" })).rejects.toThrow(/conversation changed/);
  expect(calls).toEqual(["operation.status", "operation.status"]);
  client.close();
});


it("commits Linux authority synchronously before timers or microtasks can interrupt publication", async () => {
  if (process.platform !== "linux") return;
  const pending = saveClaudeRegistration(hello("sync-authority"));
  // Intentionally inspect before awaiting: baseline first awaits ps and has no journal.
  const name = readdirSync(join(home, "contexts")).find(item => item.endsWith(".d"));
  expect(name).toBeDefined();
  const path = join(home, "contexts", name ?? "missing", "1.json");
  const value = JSON.parse(readFileSync(path, "utf8")) as { birth: string; hello: { vendor_session_id: string } };
  expect(value.birth).toMatch(/^linux-v1:/); expect(value.hello.vendor_session_id).toBe("sync-authority");
  expect(statSync(path).mode & 0o777).toBe(0o600);
  await pending;
  expect((await activeClaudeRegistration(process.pid)).hello.vendor_session_id).toBe("sync-authority");
});

it("rejects oversized committed records without falling back to older authority", async () => {
  await saveClaudeRegistration(hello("bounded-authority"));
  const name = (await readdir(join(home, "contexts"))).find(item => item.endsWith(".d"));
  if (!name) throw new Error("missing journal");
  await writeFile(join(home, "contexts", name, "1.json"), " ".repeat(16_385));
  await expect(activeClaudeRegistration(process.pid)).rejects.toThrow("unavailable or expired");
  await expect(saveClaudeRegistration(hello("bounded-authority"))).rejects.toThrow("invalid registration file");
});
