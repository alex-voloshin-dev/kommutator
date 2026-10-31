import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { Ident, toIdent } from "@kommutator/protocol";
import { pathsFor } from "@kommutator/agentd";
import * as z from "zod";

const Config = z.object({ hub: z.string().url().refine((value) => ["http:", "https:", "ws:", "wss:"].includes(new URL(value).protocol), "Expected an HTTP or WebSocket hub URL"), key: z.string().min(16), host: Ident });
const object = z.record(z.string(), z.unknown());
const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"] as const;

function isKomHook(value: unknown, event: string): boolean {
  const parsed = object.safeParse(value);
  if (!parsed.success) return false;
  const hook = parsed.data;
  return hook.type === "command" && ((hook.command === "kom" && Array.isArray(hook.args) && hook.args[0] === "hook" && hook.args[1] === event)
    || hook.command === `kom hook ${event}`);
}

/** Preserve unrelated vendor configuration and hooks; replace this integration's entries once. */
export function mergeClaudeHooks(value: unknown): Record<string, unknown> {
  return mergeHooks(value, "claude");
}

export function mergeCodexHooks(value: unknown): Record<string, unknown> {
  return mergeHooks(value, "codex");
}

function mergeHooks(value: unknown, vendor: "claude" | "codex"): Record<string, unknown> {
  const settings = object.parse(value);
  const hooks = settings.hooks === undefined ? {} : object.parse(settings.hooks);
  const merged: Record<string, unknown> = { ...hooks };
  for (const event of events) {
    const previous = hooks[event] === undefined ? [] : z.array(object).parse(hooks[event]);
    const retained: Record<string, unknown>[] = [];
    for (const group of previous) {
      if (!Array.isArray(group.hooks)) { retained.push(group); continue; }
      const remaining = group.hooks.filter((hook) => !isKomHook(hook, event) && !(vendor === "codex" && object.safeParse(hook).success && object.parse(hook).command === `kom hook ${event} --vendor codex`));
      if (remaining.length > 0) retained.push({ ...group, hooks: remaining });
    }
    retained.push({ hooks: [{ type: "command", ...(vendor === "codex" ? { command: `kom hook ${event} --vendor codex` } : { command: "kom", args: ["hook", event] }), timeout: event === "SessionEnd" ? 1 : 5 }] });
    merged[event] = retained;
  }
  return { ...settings, hooks: merged };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}

async function writePrivate(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temp, path);
  await chmod(path, 0o600);
}

export async function initialize(options: { hub?: string; key?: string; host?: string; home?: string; claudeSettings?: string; codexHooks?: string; vendor?: "claude" | "codex"; hooks?: boolean }): Promise<{ config: string; claudeSettings?: string; codexHooks?: string; next?: string[] }> {
  const paths = pathsFor(options.home);
  const previous = await readJson(paths.config);
  const existing = previous === undefined ? {} : object.parse(previous);
  const config = Config.parse({ hub: options.hub ?? existing.hub ?? "http://127.0.0.1:8787", key: options.key ?? process.env.KOM_KEY ?? existing.key, host: options.host ?? existing.host ?? toIdent(hostname()) });
  const codex = options.vendor === "codex";
  const settingsPath = codex ? options.codexHooks ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "hooks.json") : options.claudeSettings ?? join(homedir(), ".claude", "settings.json");
  // Validate both files before replacing either. Never change the vendor inbound policy.
  const settings = options.hooks === false ? undefined : (codex ? mergeCodexHooks : mergeClaudeHooks)(await readJson(settingsPath) ?? {});
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700);
  await writePrivate(paths.config, config);
  if (settings) {
    await writePrivate(settingsPath, settings);
    return codex ? { config: paths.config, codexHooks: settingsPath, next: ["codex mcp add kommutator -- kom mcp", "Review and trust these hooks in /hooks, then start a fresh local root and call whoami."] } : { config: paths.config, claudeSettings: settingsPath };
  }
  return { config: paths.config };
}
