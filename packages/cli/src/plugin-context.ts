import { mkdir, readFile, link, unlink, writeFile, readdir } from "node:fs/promises";
import { mkdirSync, opendirSync, openSync, fstatSync, readSync, closeSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { pathsFor } from "@kommutator/agentd/paths";
import { processStart, processStartSync } from "@kommutator/agentd/process";
import * as z from "zod";
import { IpcHello, RUNTIME_CONTRACT } from "@kommutator/protocol/hello";

const Context = z.object({ cwd: z.string().min(1).max(1024).refine(isAbsolute) }).strict();
function contextPath(vendor: string, id: string): string {
  return join(pathsFor().home, "contexts", createHash("sha256").update(`${vendor}:${id}`).digest("hex") + ".json");
}
export async function savePluginContext(vendor: string, id: string, cwd: string | undefined): Promise<void> {
  const context = Context.parse({ cwd });
  const directory = join(pathsFor().home, "contexts");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = contextPath(vendor, id);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(context), { mode: 0o600, flag: "wx" });
  try {
    await link(temp, path);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    if (await pluginContext(vendor, id) !== context.cwd) throw new Error("Conflicting project context for this root; start a fresh session");
  } finally { await unlink(temp); }
}
export async function pluginContext(vendor: string, id: string): Promise<string> {
  try { return Context.parse(JSON.parse(await readFile(contextPath(vendor, id), "utf8")) as unknown).cwd; }
  catch { throw new Error("Project context unavailable. Trust the plugin hooks and start a fresh session; plugin cache cwd cannot identify your project."); }
}

// Claude may resume one vendor conversation in multiple live processes.
async function claudeOwnerPaths(id: string, pid: number): Promise<{ file: string; directory: string; birth: string }> {
  const birth = await processStart(z.number().int().positive().parse(pid));
  if (!birth) throw new Error("Claude root registration unavailable or expired");
  return { file: contextPath("claude-registration", JSON.stringify([id, pid, birth])),
    directory: contextPath("claude-active", JSON.stringify([pid, birth])) + ".d", birth };
}
async function latestGeneration(directory: string): Promise<number> {
  const generations = (await readdir(directory)).filter(name => /^[1-9][0-9]*\.json$/.test(name)).map(name => Number(name.slice(0, -5)));
  if (generations.some(n => !Number.isSafeInteger(n)) || generations.length > 10_000) throw new Error("invalid generation journal");
  return Math.max(0, ...generations);
}
export interface ActiveClaudeRegistration { hello: import("./ipc-client.js").Hello; generation: string; birth: string }

const MAX_REGISTRATION_BYTES = 16_384;
function readRegistration(path: string): string {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_REGISTRATION_BYTES) throw new Error("invalid registration file");
    const buffer = Buffer.alloc(MAX_REGISTRATION_BYTES + 1);
    let length = 0;
    for (;;) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      length += count;
      if (length > MAX_REGISTRATION_BYTES) throw new Error("invalid registration file");
      if (!count) return buffer.toString("utf8", 0, length);
    }
  } finally { closeSync(fd); }
}
function currentGeneration(directory: string): number {
  const dir = opendirSync(directory);
  let count = 0; let generations = 0; let latest = 0;
  try {
    for (;;) {
      const entry = dir.readSync(); if (!entry) break;
      if (++count > 20_000) throw new Error("invalid generation journal");
      if (!/^[1-9][0-9]*\.json$/.test(entry.name)) continue;
      const generation = Number(entry.name.slice(0, -5));
      if (!Number.isSafeInteger(generation) || ++generations >= 10_000) throw new Error("invalid generation journal");
      latest = Math.max(latest, generation);
    }
  } finally { dir.closeSync(); }
  return latest;
}
export async function saveClaudeRegistration(hello: import("./ipc-client.js").Hello): Promise<ActiveClaudeRegistration | undefined> {
  const parsed = IpcHello.parse(hello);
  if (parsed.client !== "hook" || parsed.vendor !== "claude-code" || !parsed.vendor_session_id || !parsed.ppid) return;
  if (parsed.runtime_contract !== RUNTIME_CONTRACT) throw new Error("Incompatible Claude hook runtime");
  Context.parse({ cwd: parsed.cwd });
  // No asynchronous boundary between the Linux birth read and immutable publication.
  const birth = process.platform === "linux" ? processStartSync(parsed.ppid) : await processStart(parsed.ppid);
  if (!birth) throw new Error("Claude root registration unavailable or expired");
  const directory = contextPath("claude-active", JSON.stringify([parsed.ppid, birth])) + ".d";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = currentGeneration(directory);
    if (previous) {
      const prior = z.object({ hello: IpcHello, birth: z.string(), generation: z.number().int().positive() }).strict()
        .parse(JSON.parse(readRegistration(join(directory, `${previous}.json`))) as unknown);
      if (prior.birth !== birth || prior.hello.ppid !== parsed.ppid || prior.generation !== previous || prior.hello.owner_generation !== previous) throw new Error("Conflicting Claude process context");
      if (prior.hello.vendor_session_id === parsed.vendor_session_id && prior.hello.cwd !== parsed.cwd) throw new Error("Conflicting Claude project context");
    }
    const generation = previous + 1;
    const value = { hello: { ...parsed, owner_generation: generation }, birth, generation };
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_REGISTRATION_BYTES) throw new Error("invalid registration file");
    const temp = join(directory, `${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
      try { linkSync(temp, join(directory, `${generation}.json`)); }
      catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue; throw error; }
      return { hello: value.hello, generation: `${birth}:${generation}`, birth };
    } finally { try { unlinkSync(temp); } catch { /* The immutable publication is authoritative. */ } }
  }
  throw new Error("Concurrent Claude registration changes; resume again");
}
export async function claudeRegistration(id: string, ownerPid: number): Promise<import("./ipc-client.js").Hello> {
  const active = await activeClaudeRegistration(ownerPid);
  if (active.hello.vendor_session_id !== id) throw new Error("Claude root registration unavailable or expired");
  return active.hello;
}
export async function activeClaudeRegistration(ownerPid: number, legacyId?: string): Promise<ActiveClaudeRegistration> {
  try {
    const { directory, birth } = await claudeOwnerPaths("", ownerPid);
    const generation = await latestGeneration(directory);
    if (!generation) throw new Error("incomplete");
    try { await readFile(join(directory, `${generation}.ended`)); throw new Error("ended"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const value = z.object({ hello: IpcHello, birth: z.string(), generation: z.number().int().positive() }).strict().parse(JSON.parse(readRegistration(join(directory, `${generation}.json`))) as unknown);
    if (value.hello.runtime_contract !== RUNTIME_CONTRACT || value.generation !== generation || value.hello.owner_generation !== generation || value.birth !== birth || value.hello.ppid !== ownerPid || value.hello.client !== "hook" || value.hello.vendor !== "claude-code" || !value.hello.vendor_session_id) throw new Error("expired");
    Context.parse({ cwd: value.hello.cwd });
    if (await processStart(ownerPid) !== birth || await latestGeneration(directory) !== generation) throw new Error("changed");
    try { await readFile(join(directory, `${generation}.ended`)); throw new Error("ended"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    return { hello: value.hello, generation: `${birth}:${generation}`, birth };
  } catch { throw new Error("Claude root registration unavailable or expired. Run /exit, then run claude --resume from a terminal in the same project and select this conversation. Trust the updated plugin hooks so SessionStart can register it. /reload-plugins alone is insufficient; setup_status configuration and daemon compatibility do not prove session registration."); }
}
export async function forgetClaudeRegistration(id: string, ownerPid: number, observed?: ActiveClaudeRegistration): Promise<void> {
  // SessionEnd must retire exactly its captured generation, never a later A → B → A.
  let active = observed;
  if (!active) try { active = await activeClaudeRegistration(ownerPid); } catch { /* Exact legacy cleanup still applies. */ }
  const paths = active ? {
    file: contextPath("claude-registration", JSON.stringify([id, ownerPid, active.birth])),
    directory: contextPath("claude-active", JSON.stringify([ownerPid, active.birth])) + ".d",
  } : await claudeOwnerPaths(id, ownerPid);
  const { file, directory } = paths;
  if (active && (active.hello.ppid !== ownerPid || active.hello.vendor_session_id !== id)) return;
  if (active?.hello.vendor_session_id === id && active.hello.owner_generation !== undefined) {
    await writeFile(join(directory, `${active.hello.owner_generation}.ended`), "", { mode: 0o600 });
  }
  try { await unlink(file); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
}
