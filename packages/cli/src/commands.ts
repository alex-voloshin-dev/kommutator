import { defineCommand, runMain } from "citty";
import { PROTOCOL_VERSION, Message } from "@kommutator/protocol";
import { pathsFor, runDaemon } from "@kommutator/agentd";
import { IpcClient, cliHello, spawnDaemon } from "./ipc-client.js";
import { initialize } from "./init.js";
import { readStatus, runDoctor } from "./doctor.js";
import { runLogs } from "./logs.js";
import { boardCommand } from "./board.js";
import * as z from "zod";

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const notYet = (name: string) => () => { throw new Error(`kom ${name}: deferred; see docs/MVP_PLAN.md`); };

async function management(method: string, params: Record<string, unknown> = {}, lazyStart = true): Promise<unknown> {
  const client = new IpcClient({ hello: cliHello, lazyStart });
  try { return await client.call(method, params); } finally { client.close(); }
}

export function terminalMessage(to: string, body: string, wake: boolean, isTTY: boolean): { message: Record<string, unknown> } {
  const message = Message.omit({ from: true }).parse({ to: to.split(",").map((address) => address.trim()), body, origin: isTTY ? "human" : "agent", force_wake: isTTY && wake });
  return { message };
}

async function stopDaemon(): Promise<void> {
  try { await management("daemon.shutdown", {}, false); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
  }
  // Wait for the old listener to close before a restart attempts the single-instance lock.
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await management("daemon.status", {}, false); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "ENOENT" || code === "ECONNREFUSED") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Daemon did not stop within 2 seconds");
}

async function hubRun(): Promise<void> {
  const key = process.env.KOM_KEY;
  if (!key || key.length < 16) throw new Error("KOM_KEY is required (at least 16 characters)");
  const port = Number(process.env.KOM_HUB_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("KOM_HUB_PORT must be between 1 and 65535");
  const { openDatabase } = await import("@kommutator/hub/db");
  const { createHubServer } = await import("@kommutator/hub");
  const db = openDatabase(process.env.KOM_HUB_DB ?? "./kommutator.db");
  const server = createHubServer({ db, key });
  server.once("error", (error) => { console.error("kom hub:", error.message); db.close(); process.exitCode = 1; });
  server.listen(port, process.env.KOM_HUB_BIND ?? "127.0.0.1", () => console.error(`kom hub listening on ${process.env.KOM_HUB_BIND ?? "127.0.0.1"}:${port}`));
  const close = () => server.close(() => { db.close(); });
  process.once("SIGTERM", close); process.once("SIGINT", close);
}

export async function runCommands(): Promise<void> {
  const main = defineCommand({
    meta: { name: "kom", description: "kommutator — switchboard for coding agents" },
    subCommands: {
      daemon: defineCommand({ meta: { name: "daemon", description: "manage the per-host daemon" }, subCommands: {
        run: defineCommand({ meta: { name: "run" }, run: async () => { await runDaemon(); } }),
        stop: defineCommand({ meta: { name: "stop" }, run: stopDaemon }),
        restart: defineCommand({ meta: { name: "restart" }, run: async () => { await stopDaemon(); spawnDaemon(); print(await management("daemon.status")); } }),
      } }),
      mcp: defineCommand({ run: async () => { const { runMcp } = await import("./mcp.js"); await runMcp(); } }),
      init: defineCommand({ meta: { description: "write private daemon config and merge selected vendor hooks" }, args: {
        hub: { type: "string" }, key: { type: "string", description: "prefer KOM_KEY to avoid shell-history exposure" }, host: { type: "string" },
        hooks: { type: "boolean", default: true, description: "install vendor hooks; use --no-hooks with a plugin" }, "claude-settings": { type: "string" },
        vendor: { type: "string", default: "claude", description: "claude | codex" }, "codex-hooks": { type: "string" },
      }, run: async ({ args }) => {
        const input = z.object({ hub: z.string().optional(), key: z.string().optional(), host: z.string().optional(), hooks: z.boolean().default(true), vendor: z.enum(["claude", "codex"]), "codex-hooks": z.string().optional(), "claude-settings": z.string().optional() }).parse(args);
        print(await initialize({ ...(input.hub ? { hub: input.hub } : {}), ...(input.key ? { key: input.key } : {}), ...(input.host ? { host: input.host } : {}), hooks: input.hooks, vendor: input.vendor, ...(input["codex-hooks"] ? { codexHooks: input["codex-hooks"] } : {}), ...(input["claude-settings"] ? { claudeSettings: input["claude-settings"] } : {}) }));
      } }),
      watch: defineCommand({ meta: { description: "observe one joined topic without receipts or registration" }, args: {
        session: { type: "string", required: true }, topic: { type: "string", required: true },
        "since-seq": { type: "string", description: "resume after this sequence; default is future messages only" },
      }, run: async ({ args }) => {
        const input = z.object({ session: z.string(), topic: z.string(), "since-seq": z.coerce.number().int().nonnegative().optional() }).parse(args);
        const { runWatch } = await import("./watch.js");
        await runWatch({ session: input.session, topic: input.topic, ...(input["since-seq"] === undefined ? {} : { sinceSeq: input["since-seq"] }) });
      } }),
      status: defineCommand({ run: async () => { print(await readStatus()); } }),
      dnd: defineCommand({ args: { mode: { type: "positional", required: true, description: "on | off" }, session: { type: "string" } }, run: async ({ args }) => {
        if (args.mode !== "on" && args.mode !== "off") throw new Error("dnd expects on or off");
        print(await management("session.dnd", { wake: args.mode === "on" ? "off" : "on", ...(args.session ? { session: args.session } : {}) }));
      } }),
      send: defineCommand({ args: { to: { type: "string", required: true }, text: { type: "positional", required: true }, wake: { type: "boolean", default: false } }, run: async ({ args }) => {
        const input = z.object({ to: z.string(), text: z.string(), wake: z.boolean() }).parse(args);
        print(await management("human.send", terminalMessage(input.to, input.text, input.wake, process.stdin.isTTY === true)));
      } }),
      hub: defineCommand({ subCommands: {
        run: defineCommand({ run: hubRun }),
        backup: defineCommand({ args: { file: { type: "positional", required: true }, db: { type: "string" } }, run: async ({ args }) => {
          const input = z.object({ file: z.string(), db: z.string().optional() }).parse(args);
          const { DatabaseSync } = await import("node:sqlite");
          const { backupDatabase } = await import("@kommutator/hub/db");
          const db = new DatabaseSync(input.db ?? process.env.KOM_HUB_DB ?? "./kommutator.db", { readOnly: true });
          try { backupDatabase(db, input.file); } finally { db.close(); }
          print({ backup: input.file });
        } }),
        prune: defineCommand({ run: notYet("hub prune (replay-safety contract required)") }),
      } }),
      board: boardCommand,
      doctor: defineCommand({ meta: { description: "read-only diagnostics; never starts the daemon" }, args: {
        "timeout-ms": { type: "string", default: "1500", description: "per-check deadline, 50–10000 ms" },
        "claude-settings": { type: "string", description: "inspect this Claude settings file instead of defaults" },
        "codex-hooks": { type: "string", description: "inspect this Codex hooks file instead of defaults" },
        "plugin-dir": { type: "string", description: "inspect Claude plugin assets; does not prove activation" },
      }, run: async ({ args }) => {
        const input = z.object({ "timeout-ms": z.string(), "claude-settings": z.string().optional(), "codex-hooks": z.string().optional(), "plugin-dir": z.string().optional() }).parse(args);
        const result = await runDoctor({ timeoutMs: Number(input["timeout-ms"]),
          ...(input["claude-settings"] ? { claudeSettings: input["claude-settings"] } : {}),
          ...(input["codex-hooks"] ? { codexHooks: input["codex-hooks"] } : {}),
          ...(input["plugin-dir"] ? { pluginDir: input["plugin-dir"] } : {}),
        });
        print(result);
        if (!result.ok) process.exitCode = 1;
      } }),
      logs: defineCommand({ args: { follow: { type: "boolean", alias: "f", default: false }, lines: { type: "string", default: "100" } }, run: async ({ args }) => { await runLogs(z.object({ follow: z.boolean(), lines: z.string() }).parse(args)); } }),
      paths: defineCommand({ run: () => print({ protocol_version: PROTOCOL_VERSION, ...pathsFor() }) }),
    },
  });
  await runMain(main);
}
