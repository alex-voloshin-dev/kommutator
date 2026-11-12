import { phase, withCleanup, matchesFixtureDaemon } from "./fixture-lifecycle.js";
import { processStart } from "@kommutator/agentd/process";
import { expectHookProcessTime } from "./hook-timing.js";
import { readHookObservations } from "../src/hook-observations.js";
import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const Reply = z.object({ isError: z.boolean().optional(), content: z.array(z.object({ type: z.literal("text"), text: z.string() })) });
const Identity = z.object({ session: RegisteredSession });

// Read only after a failed retirement assertion; never emit stored identities or paths.
async function retirementEvidence(home: string, cwd: string, reply: { error: boolean; text: string }, sessionId: string) {
  const journals: unknown[] = [];
  let unreadable = false;
  try {
    const directories = (await readdir(join(home, "contexts"), { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).slice(0, 8);
    for (const directory of directories) {
      const path = join(home, "contexts", directory.name);
      const names = await readdir(path);
      const rows: unknown[] = [];
      for (const name of names.filter(name => /^[1-9][0-9]*\.json$/.test(name)).slice(0, 32)) {
        const generation = Number(name.slice(0, -5));
        const file = join(path, name);
        const info = await lstat(file);
        if (!info.isFile() || info.size > 8192) { unreadable = true; continue; }
        try {
          const record = z.object({ generation: z.number(), hello: z.object({
            owner_generation: z.number().optional(), ppid: z.number().optional(),
            vendor_session_id: z.string().optional(), cwd: z.string().optional(),
          }) }).parse(JSON.parse(await readFile(file, "utf8")) as unknown);
          rows.push({ generation, recordGenerationMatches: record.generation === generation,
            ownerGenerationMatches: record.hello.owner_generation === generation,
            ownerMatches: record.hello.ppid === process.pid, resumedVendorMatches: record.hello.vendor_session_id === "resumed-b",
            cwdMatches: record.hello.cwd === cwd, ended: names.includes(`${generation}.ended`) });
        } catch { unreadable = true; }
      }
      journals.push({ rows, truncated: names.filter(name => name.endsWith(".json")).length > 32 });
    }
  } catch { unreadable = true; }
  let identity;
  try { identity = Identity.safeParse(JSON.parse(reply.text) as unknown); } catch { /* Error replies are plain text. */ }
  return { journals, unreadable, replyError: reply.error, identityParsed: identity?.success === true,
    resumedVendorMatches: identity?.success ? identity.data.session.vendor_session_id === "resumed-b" : null,
    registeredSessionMatches: identity?.success ? identity.data.session.id === sessionId : null };
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kom-resume-process-"));
  const cwd = join(home, "project");
  await mkdir(cwd);
  const db = openDatabase(":memory:");
  const hub = createHubServer({ db, key: "resume-process-fixture-key" });
  await new Promise<void>(resolve => hub.listen(0, "127.0.0.1", resolve));
  const address = hub.address();
  if (!address || typeof address === "string") throw new Error("missing test hub port");
  await writeFile(join(home, "config.json"), JSON.stringify({ hub: `http://127.0.0.1:${address.port}`, key: "resume-process-fixture-key", host: "resume-fixture" }), { mode: 0o600 });
  const env = {
    PATH: process.env.PATH ?? "", HOME: home, KOM_HOME: home, KOM_PROJECT: "resume-process",
    KOM_PLUGIN_PROFILE: "claude-code", KOM_CLAUDE_OWNER_PID: String(process.pid),
    CLAUDE_CODE_SESSION_ID: "launch-a", CLAUDE_CODE_MESSAGING_SOCKET: "",
  };
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, "mcp"], cwd, env, stderr: "pipe" });
  transport.stderr?.resume();
  const client = new Client({ name: "claude-code", version: "synthetic-resume" });
  await client.connect(transport);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const reply = Reply.parse(await phase(`MCP ${name}`, () => client.callTool({ name, arguments: args })));
    const text = reply.content[0]?.text;
    if (!text) throw new Error("missing tool reply");
    return { error: reply.isError === true, text };
  }
  const hookEvidence: unknown[] = [];
  return {
    home, cwd, db, transport, call, hookEvidence,
    async whoami() {
      const reply = await call("whoami");
      expect(reply.error, reply.text).toBe(false);
      return Identity.parse(JSON.parse(reply.text) as unknown).session;
    },
    async hook(id: string, event = "SessionStart", preload?: string) {
      // Both children have this real test process as owner. MCP retains launch-a forever.
      const started = performance.now();
      const child = spawn(process.execPath, [...(preload ? ["--import", preload] : []), entry, "hook", event], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.stderr.resume();
      const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      child.stdin.end(JSON.stringify({ session_id: id, cwd, permission_mode: "default" }));
      expect(await done).toBe(0);
      expect(stdout).toBe("");
      const elapsed = performance.now() - started;
      const observations = await readHookObservations(undefined, home);
      const authority: unknown[] = [];
      try {
        for (const directory of await readdir(join(home, "contexts"), { withFileTypes: true })) {
          if (!directory.isDirectory()) continue;
          const path = join(home, "contexts", directory.name);
          for (const name of await readdir(path)) {
            if (!name.endsWith(".json")) continue;
            const record = JSON.parse(await readFile(join(path, name), "utf8"));
            authority.push({ generation: record.generation, root: record.hello?.vendor_session_id });
          }
        }
      } catch { /* Absent/partial authority is itself diagnostic evidence. */ }
      const evidence = { id, event, elapsed, observations, authority };
      hookEvidence.push(evidence);
      if (process.env.KOM_TEST_HOOK_EVIDENCE) console.error(JSON.stringify(evidence));
      return elapsed;
    },
    async close() {
      const failures: unknown[] = [];
      async function step(label: string, run: () => Promise<unknown>, timeoutMs = 1500) {
        try { await phase(`cleanup ${label}`, run, timeoutMs); } catch (error) { failures.push(error); }
      }
      let daemon: { pid: number; birth: string | undefined } | undefined;
      let safeToRemoveHome = false;
      await step("capture owned daemon", async () => {
        try {
          const info = z.object({ pid: z.number().int().positive(), endpoint: z.literal(join(home, "agentd.sock")) })
            .parse(JSON.parse(await readFile(join(home, "agentd.json"), "utf8")) as unknown);
          safeToRemoveHome = false;
          daemon = { pid: info.pid, birth: undefined };
          daemon.birth = await processStart(info.pid);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
          safeToRemoveHome = true;
        }
      });
      // SDK close has two 2-second grace periods before killing its owned child.
      await step("MCP close", () => client.close(), 5000);
      const management = new IpcClient({ endpoint: join(home, "agentd.sock"), timeoutMs: 1000, lazyStart: false,
        hello: () => ({ client: "cli", protocol_version: PROTOCOL_VERSION, pid: process.pid, cwd }) });
      try {
        await step("daemon.shutdown", async () => {
          try { await management.call("daemon.shutdown"); }
          catch (error) {
            const code = error instanceof Error && "code" in error ? error.code : undefined;
            if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
          }
        });
      } finally { management.close(); }
      await step("owned daemon termination", async () => {
        if (!daemon) return;
        const owned = daemon;
        const alive = () => {
          try { process.kill(owned.pid, 0); return true; }
          catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
            throw error;
          }
        };
        // daemon.shutdown schedules its exit; give that normal path a bounded grace period.
        const graceEnd = performance.now() + 500;
        while (alive() && performance.now() < graceEnd) await new Promise(resolve => setTimeout(resolve, 20));
        if (!alive()) { safeToRemoveHome = true; return; }
        const birth = await processStart(owned.pid);
        if (!owned.birth || !birth || birth !== owned.birth) throw new Error("Live daemon ownership is unverified; preserving fixture home");
        if (process.platform !== "linux") throw new Error("Owned daemon did not exit; safe fallback verification requires Linux");
        // Never signal from a PID file alone: verify this fixture's private home and command.
        let environment: string, command: string;
        try {
          [environment, command] = await Promise.all([
            readFile(`/proc/${owned.pid}/environ`, "utf8"), readFile(`/proc/${owned.pid}/cmdline`, "utf8"),
          ]);
        } catch (error) {
          if (!alive()) { safeToRemoveHome = true; return; }
          throw error;
        }
        if (!matchesFixtureDaemon(command, environment, process.execPath, entry, home)) {
          throw new Error("Refusing to terminate a process without matching fixture ownership");
        }
        if (!alive()) { safeToRemoveHome = true; return; }
        if (await processStart(owned.pid) !== owned.birth) throw new Error("Daemon birth changed or is unavailable; preserving fixture home");
        try { process.kill(owned.pid, "SIGKILL"); }
        catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
        const exitEnd = performance.now() + 500;
        while (alive() && performance.now() < exitEnd) await new Promise(resolve => setTimeout(resolve, 20));
        if (alive()) throw new Error("Daemon exit unconfirmed; preserving fixture home");
        safeToRemoveHome = true;
      }, 3500);
      await step("hub close", async () => {
        hub.closeAllConnections();
        await new Promise<void>((resolve, reject) => hub.close(error => error ? reject(error) : resolve()));
      });
      try { db.close(); } catch (error) { failures.push(new Error("Fixture phase: cleanup database close", { cause: error })); }
      if (safeToRemoveHome) await step("remove fixture home", () => rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
      else failures.push(new Error("Fixture home preserved because daemon exit or ownership is unconfirmed"));
      if (failures.length) throw new AggregateError(failures, "Fixture cleanup failed");

    },
  };
}

it("a running MCP resolves resumed hook identity despite its stale launch ID, then follows B to A to B", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    const pid = f.transport.pid;
    expect(JSON.parse((await f.call("setup_status")).text)).toMatchObject({ configured: true });
    const unregistered = await f.call("whoami");
    expect(unregistered.error).toBe(true);
    expect(unregistered.text).toContain("Run /exit, then run claude --resume from a terminal in the same project and select this conversation");
    expect(unregistered.text).toContain("Trust the updated plugin hooks so SessionStart can register it");
    expect(unregistered.text).toContain("/reload-plugins alone is insufficient");
    expect(unregistered.text).toContain("setup_status configuration and daemon compatibility do not prove session registration");
    // Loading MCP mid-session and submitting a prompt cannot replace SessionStart authority.
    await f.hook("resumed-b", "UserPromptSubmit");
    expect(await f.call("whoami")).toEqual(unregistered);
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    await f.hook("resumed-b");
    const b = await f.whoami();
    expect(b.vendor_session_id).toBe("resumed-b");
    expect(b.cwd).toBe(f.cwd);
    await f.hook("resumed-b");
    const repeated = await f.whoami();
    expect(repeated.id).toBe(b.id);
    expect(repeated.incarnation).toBe(b.incarnation);
    expect((await f.call("set_status", { status_line: "B status", role: "reviewer" })).error).toBe(false);
    await f.hook("launch-a");
    const a = await f.whoami();
    expect(a.vendor_session_id).toBe("launch-a");
    expect(a.id).not.toBe(b.id);
    expect((await f.call("set_status", { status_line: "A status", role: "author" })).error).toBe(false);
    expect(f.db.prepare("SELECT state FROM sessions WHERE id = ?").get(b.id)).toEqual({ state: "gone" });
    await f.hook("resumed-b", "SessionEnd");
    expect((await f.whoami()).id).toBe(a.id);
    await f.hook("resumed-b");
    const back = await f.whoami();
    expect(back.id, JSON.stringify(f.hookEvidence)).toBe(b.id);
    expect(back.incarnation).toBeGreaterThan(b.incarnation);
    expect(back.status_line).toBe("B status");
    expect(back.role).toBe("reviewer");
    expect(f.db.prepare("SELECT state FROM sessions WHERE id = ?").get(a.id)).toEqual({ state: "gone" });
    expect(f.transport.pid).toBe(pid);
    const endedIn = await f.hook("resumed-b", "SessionEnd");
    const endReply = await f.call("whoami");
    const contexts = join(f.home, "contexts");
    const generations = await Promise.all((await readdir(contexts, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => readdir(join(contexts, entry.name))));
    expect(endReply.error, JSON.stringify({ endedIn, generations, reply: endReply.text })).toBe(true);
    const status = await f.call("status");
    // Local authority retirement and daemon/hub reconciliation are independent outcomes.
    // The status read reconciles an interrupted notification; never replay SessionEnd here.
    await expect.poll(() => f.db.prepare("SELECT state FROM sessions WHERE id = ?").get(back.id),
      { timeout: 1_000 }).toEqual({ state: "gone" });
    expect(status.error, status.text).toBe(false);
    expect(JSON.parse(status.text)).toMatchObject({ runtime_contract: 3, daemon: { running: true } });
    expect((await f.call("whoami")).error).toBe(true);
    expect(JSON.parse((await f.call("setup_status")).text)).toMatchObject({ configured: true });
  }, () => f.close());
}, 20_000);

it("malformed or missing active authority cannot fall back to a fenced launch registration", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    await f.hook("launch-a");
    await f.whoami();
    const contexts = join(f.home, "contexts");
    const directories = (await readdir(contexts, { withFileTypes: true })).filter(entry => entry.isDirectory());
    expect(directories).toHaveLength(1);
    const directory = join(contexts, directories[0]!.name);
    const generations = (await readdir(directory)).filter(name => name.endsWith(".json"));
    expect(generations).toHaveLength(1);
    const path = join(directory, generations[0]!);
    const original = await readFile(path, "utf8");
    await writeFile(path, "{broken");
    expect((await f.call("whoami")).error).toBe(true);
    // Restoring this synthetic fixture proves rejection was caused by corrupt authority.
    await writeFile(path, original);
    expect((await f.whoami()).vendor_session_id).toBe("launch-a");
    await rename(directory, directory + ".hidden");
    try { expect((await f.call("whoami")).error).toBe(true); }
    finally { await rename(directory + ".hidden", directory); }
    expect((await f.whoami()).vendor_session_id).toBe("launch-a");
    await rm(path);
    expect((await f.call("whoami")).error).toBe(true);
  }, () => f.close());
}, 15_000);

it("publishes resumed authority and ends it even when diagnostic storage never completes", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    await f.hook("launch-a");
    expect((await f.whoami()).vendor_session_id).toBe("launch-a");
    const preload = join(f.home, "stall-observations.mjs");
    await writeFile(preload, `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const mkdir = fs.mkdir;
      fs.mkdir = function(path, ...args) {
        if (String(path).endsWith("/hook-observations")) return new Promise(() => {});
        return mkdir.call(this, path, ...args);
      };
      syncBuiltinESMExports();
    `);
    expectHookProcessTime(await f.hook("resumed-b", "SessionStart", preload), "SessionStart stalled observation");
    const resumed = await f.whoami();
    expect(resumed.vendor_session_id).toBe("resumed-b");
    const elapsed = await f.hook("resumed-b", "SessionEnd", preload);
    expectHookProcessTime(elapsed, "SessionEnd stalled observation");
    const reply = await f.call("whoami");
    if (!reply.error) {
      console.error("[retirement-failure]", JSON.stringify({ elapsed,
        ...await retirementEvidence(f.home, f.cwd, reply, resumed.id) }));
    }
    expect(reply.error).toBe(true);
  }, () => f.close());
}, 15_000);

it("commits SessionStart authority before a delayed delivery-module import reaches the hook deadline", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    const preload = join(f.home, "delay-hook-delivery.mjs");
    const marker = join(f.home, "delivery-import-started");
    await writeFile(preload, `
      import { writeFileSync } from "node:fs";
      import { registerHooks } from "node:module";
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (/\\/hooks-[^/]+\\.js$/.test(url)) {
          writeFileSync(${JSON.stringify(marker)}, "delayed");
          return { ...result, source: 'await new Promise(resolve => setTimeout(resolve, 500));\\n' + result.source };
        }
        return result;
      } });
    `);
    expectHookProcessTime(await f.hook("resumed-before-delivery", "SessionStart", preload), "SessionStart delayed import");
    expect(await readFile(marker, "utf8")).toBe("delayed");
    const session = await f.whoami();
    expect(session.vendor_session_id).toBe("resumed-before-delivery");
    expect(f.hookEvidence).toHaveLength(1);
    const evidence = f.hookEvidence[0] as { authority: Array<{ generation: number; root: string }> };
    expect(evidence.authority).toEqual([{ generation: 1, root: "resumed-before-delivery" }]);
    // The normal path consumes the captured generation instead of publishing twice.
    await f.hook("resumed-before-delivery");
    const next = f.hookEvidence[1] as { authority: Array<{ generation: number; root: string }> };
    expect(next.authority.map(row => row.generation).sort()).toEqual([1, 2]);
    expect((await f.whoami()).id).toBe(session.id);
  }, () => f.close());
}, 15_000);

it("retires only the current SessionEnd authority before a delayed delivery import", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    await f.hook("end-after-import");
    const session = await f.whoami();
    const preload = join(f.home, "delay-hook-delivery.mjs");
    const marker = join(f.home, "delivery-import-started");
    await writeFile(preload, `
      import { writeFileSync } from "node:fs";
      import { registerHooks } from "node:module";
      registerHooks({ load(url, context, nextLoad) {
        const result = nextLoad(url, context);
        if (/\\/hooks-[^/]+\\.js$/.test(url)) {
          writeFileSync(${JSON.stringify(marker)}, "delayed");
          return { ...result, source: 'await new Promise(resolve => setTimeout(resolve, 500));\\n' + result.source };
        }
        return result;
      } });
    `);
    // A late end for another conversation must leave this generation available.
    expectHookProcessTime(await f.hook("stale-conversation", "SessionEnd", preload), "Stale SessionEnd");
    expect((await f.whoami()).id).toBe(session.id);
    expectHookProcessTime(await f.hook("end-after-import", "SessionEnd", preload), "SessionEnd delayed import");
    expect(await readFile(marker, "utf8")).toBe("delayed");
    expect((await f.call("whoami")).error).toBe(true);
    // The import never completed, so no session.gone IPC could have been submitted.
    // A status read reconciles durable end evidence without replaying the hook.
    expect((await f.call("status")).error).toBe(false);
    await expect.poll(() => f.db.prepare("SELECT state FROM sessions WHERE id = ?").get(session.id),
      { timeout: 1_000 }).toEqual({ state: "gone" });
  }, () => f.close());
}, 15_000);

it("an invalid SessionStart cannot replace previously observed conversation authority", async () => {
  const f = await fixture();
  await withCleanup(async () => {
    await f.hook("valid-conversation");
    const original = await f.whoami();
    await f.hook("");
    const current = await f.whoami();
    expect(current.id).toBe(original.id);
    expect(current.vendor_session_id).toBe("valid-conversation");
    const evidence = f.hookEvidence[1] as { authority: Array<{ generation: number; root: string }> };
    expect(evidence.authority).toEqual([{ generation: 1, root: "valid-conversation" }]);
  }, () => f.close());
}, 15_000);
