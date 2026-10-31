import { mkdir, readFile, link, rename, unlink, writeFile } from "node:fs/promises";
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

// Claude may resume one vendor conversation in multiple live processes. Cold facts
// belong to the observed process owner, never to the vendor ID alone.
async function claudeOwnerPath(id: string, pid: number): Promise<{ file: string; birth: string }> {
  const { processStart } = await import("@kommutator/agentd");
  const birth = await processStart(z.number().int().positive().parse(pid));
  if (!birth) throw new Error("Claude root registration unavailable or expired");
  return { file: contextPath("claude-registration", JSON.stringify([id, pid, birth])), birth };
}

export async function saveClaudeRegistration(hello: import("./ipc-client.js").Hello): Promise<void> {
  const { Methods } = await import("@kommutator/protocol");
  const parsed = Methods["ipc.hello"].parse(hello);
  if (parsed.client !== "hook" || parsed.vendor !== "claude-code" || !parsed.vendor_session_id || !parsed.ppid) return;
  Context.parse({ cwd: parsed.cwd });
  const { file, birth } = await claudeOwnerPath(parsed.vendor_session_id, parsed.ppid);
  await mkdir(join(pathsFor().home, "contexts"), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const lock = `${file}.lock`;
  await writeFile(lock, "", { mode: 0o600, flag: "wx" });
  try {
    try {
      const previous = z.object({ hello: Methods["ipc.hello"], birth: z.string() }).parse(JSON.parse(await readFile(file, "utf8")) as unknown);
      if (previous.hello.ppid !== parsed.ppid || previous.birth !== birth || previous.hello.vendor_session_id !== parsed.vendor_session_id || previous.hello.cwd !== parsed.cwd) {
        throw new Error("Conflicting Claude process context; start a fresh session");
      }
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    await writeFile(temp, JSON.stringify({ hello: parsed, birth }), { mode: 0o600, flag: "wx" });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => undefined);
    await unlink(lock);
  }
}
export async function claudeRegistration(id: string, ownerPid: number): Promise<import("./ipc-client.js").Hello> {
  const { Methods } = await import("@kommutator/protocol");
  try {
    const { file, birth } = await claudeOwnerPath(id, ownerPid);
    const value = z.object({ hello: Methods["ipc.hello"], birth: z.string().min(1) }).parse(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (value.hello.client !== "hook" || value.hello.vendor !== "claude-code" || value.hello.vendor_session_id !== id || value.hello.ppid !== ownerPid || value.birth !== birth) throw new Error("expired");
    Context.parse({ cwd: value.hello.cwd });
    return value.hello;
  } catch { throw new Error("Claude root registration unavailable or expired. Trust the plugin hooks and start a fresh session."); }
}

export async function forgetClaudeRegistration(id: string, ownerPid: number): Promise<void> {
  const { file } = await claudeOwnerPath(id, ownerPid);
  try { await unlink(file); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
}
