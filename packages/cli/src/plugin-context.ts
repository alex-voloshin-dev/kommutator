import { mkdir, readFile, link, rename, unlink, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { pathsFor } from "@kommutator/agentd";
import * as z from "zod";

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
  const { processStart } = await import("@kommutator/agentd");
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

export async function saveClaudeRegistration(hello: import("./ipc-client.js").Hello): Promise<ActiveClaudeRegistration | undefined> {
  const { Methods } = await import("@kommutator/protocol");
  const parsed = Methods["ipc.hello"].parse(hello);
  if (parsed.client !== "hook" || parsed.vendor !== "claude-code" || !parsed.vendor_session_id || !parsed.ppid) return;
  Context.parse({ cwd: parsed.cwd });
  const { file, directory, birth } = await claudeOwnerPaths(parsed.vendor_session_id, parsed.ppid);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const prior = z.object({ hello: Methods["ipc.hello"], birth: z.string() }).parse(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (prior.hello.ppid !== parsed.ppid || prior.birth !== birth || prior.hello.vendor_session_id !== parsed.vendor_session_id || prior.hello.cwd !== parsed.cwd) throw new Error("Conflicting Claude process context; start a fresh session");
  } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  // Immutable, atomically linked generation records need no crash-prone lock file.
  // The directory itself fences legacy fallback even if a hook dies before publication.
  for (let attempt = 0; attempt < 8; attempt++) {
    const generation = await latestGeneration(directory) + 1;
    const value = { hello: { ...parsed, owner_generation: generation }, birth, generation };
    const temp = join(directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      try { await link(temp, join(directory, `${generation}.json`)); }
      catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue; throw error; }
      // Exact legacy lookup remains for old readers; new readers use the journal only.
      const legacyTemp = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(legacyTemp, JSON.stringify({ hello: parsed, birth }), { mode: 0o600, flag: "wx" }); await rename(legacyTemp, file); }
      finally { await unlink(legacyTemp).catch(() => undefined); }
      return { hello: value.hello, generation: `${birth}:${generation}`, birth };
    } finally { await unlink(temp).catch(() => undefined); }
  }
  throw new Error("Concurrent Claude registration changes; resume again");
}
export async function claudeRegistration(id: string, ownerPid: number): Promise<import("./ipc-client.js").Hello> {
  const { Methods } = await import("@kommutator/protocol");
  try {
    const { file, birth } = await claudeOwnerPaths(id, ownerPid);
    const value = z.object({ hello: Methods["ipc.hello"], birth: z.string().min(1) }).parse(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (value.hello.client !== "hook" || value.hello.vendor !== "claude-code" || value.hello.vendor_session_id !== id || value.hello.ppid !== ownerPid || value.birth !== birth) throw new Error("expired");
    Context.parse({ cwd: value.hello.cwd });
    return value.hello;
  } catch { throw new Error("Claude root registration unavailable or expired. Trust the plugin hooks and start a fresh session."); }
}
export async function activeClaudeRegistration(ownerPid: number, legacyId?: string): Promise<ActiveClaudeRegistration> {
  const { processStart } = await import("@kommutator/agentd");
  const { Methods } = await import("@kommutator/protocol");
  try {
    const { directory, birth } = await claudeOwnerPaths("", ownerPid);
    let generation: number;
    try { generation = await latestGeneration(directory); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT") || !legacyId) throw error;
      return { hello: await claudeRegistration(legacyId, ownerPid), generation: `legacy:${birth}:${legacyId}`, birth };
    }
    if (!generation) throw new Error("incomplete");
    try { await readFile(join(directory, `${generation}.ended`)); throw new Error("ended"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    const value = z.object({ hello: Methods["ipc.hello"], birth: z.string(), generation: z.number().int().positive() }).strict().parse(JSON.parse(await readFile(join(directory, `${generation}.json`), "utf8")) as unknown);
    if (value.generation !== generation || value.hello.owner_generation !== generation || value.birth !== birth || value.hello.ppid !== ownerPid || value.hello.client !== "hook" || value.hello.vendor !== "claude-code" || !value.hello.vendor_session_id) throw new Error("expired");
    Context.parse({ cwd: value.hello.cwd });
    if (await processStart(ownerPid) !== birth || await latestGeneration(directory) !== generation) throw new Error("changed");
    try { await readFile(join(directory, `${generation}.ended`)); throw new Error("ended"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    return { hello: value.hello, generation: `${birth}:${generation}`, birth };
  } catch { throw new Error("Claude root registration unavailable or expired. Trust the updated plugin hooks and resume the conversation again; setup_status checks connection configuration only."); }
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
