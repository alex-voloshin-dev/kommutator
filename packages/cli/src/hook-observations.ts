import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"] as const;
const outcomes = ["attempted", "success", "retired-locally", "invalid-input", "identity-unavailable", "conflict", "daemon-incompatible", "hub-unavailable", "ipc-unavailable", "failed", "output-written-ack-unverified"] as const;
export type HookOutcome = typeof outcomes[number];
export interface HookObservation { event: typeof events[number] | "unknown"; outcome: HookOutcome; at: string; root_hash?: string }
const hash = (root: string) => createHash("sha256").update(root).digest("hex");
const directory = (home?: string) => join(home ?? process.env.KOM_HOME ?? join(homedir(), ".kommutator"), "hook-observations");

/** Fixed 64 slots. Collision/partial writes can lose evidence, never establish identity. */
export async function recordHookObservation(event: string | undefined, outcome: HookOutcome, root?: string, home?: string, slot = process.pid % 64): Promise<void> {
  try {
    const dir = directory(home);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) return;
    await chmod(dir, 0o700);
    const file = await open(join(dir, `${slot % 64}.json`), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      if (!(await file.stat()).isFile()) return;
      await file.chmod(0o600);
      const value: HookObservation = { event: events.includes(event as typeof events[number]) ? event as typeof events[number] : "unknown",
        outcome, at: new Date().toISOString(), ...(root ? { root_hash: hash(root) } : {}) };
      await file.writeFile(JSON.stringify(value));
    } finally { await file.close(); }
  } catch { /* Diagnostic storage must never interfere with the hook. */ }
}

export async function readHookObservations(root?: string, home?: string): Promise<HookObservation[]> {
  const dir = directory(home);
  try { const info = await lstat(dir); if (!info.isDirectory() || info.isSymbolicLink()) return []; } catch { return []; }
  const rows = await Promise.all(Array.from({ length: 64 }, async (_, slot) => {
    try {
      const file = await open(join(dir, `${slot}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 512) return undefined;
        const value: unknown = JSON.parse(await file.readFile("utf8"));
        if (!value || typeof value !== "object") return undefined;
        const row = value as Record<string, unknown>;
        if (!events.includes(row.event as typeof events[number]) && row.event !== "unknown") return undefined;
        if (!outcomes.includes(row.outcome as HookOutcome) || typeof row.at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.at)) return undefined;
        if (row.root_hash !== undefined && (typeof row.root_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.root_hash))) return undefined;
        if (root !== undefined && row.root_hash !== hash(root)) return undefined;
        return { event: row.event, outcome: row.outcome, at: row.at, ...(row.root_hash ? { root_hash: row.root_hash } : {}) } as HookObservation;
      } finally { await file.close(); }
    } catch { return undefined; }
  }));
  return rows.filter((row): row is HookObservation => row !== undefined).sort((a, b) => b.at.localeCompare(a.at));
}
