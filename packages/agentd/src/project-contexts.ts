import { constants, type Stats } from "node:fs";
import { open, mkdir, rename, unlink, lstat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import * as z from "zod";
import { Methods } from "@kommutator/protocol";
import { normalizeRemote } from "./project.js";
import { pathsFor } from "./paths.js";

const MAX_BYTES = 64 * 1024;
export const ProjectContext = z.object({
  cwd: z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes("\0")),
  remote: z.string().min(1).max(300).refine(value => !/[?#@\s]/.test(value) && normalizeRemote(`https://${value}`) === value),
  project_key: Methods["ipc.hello"].shape.project_key.unwrap(),
}).strict();
export type ProjectContext = z.infer<typeof ProjectContext>;
const ContextFile = z.object({ version: z.literal(1), entries: z.array(ProjectContext).max(128) }).strict()
  .refine(value => new Set(value.entries.map(entry => entry.cwd)).size === value.entries.length);

function privateStat(info: Stats, directory = false): void {
  if (!(directory ? info.isDirectory() : info.isFile()) || (info.mode & 0o077) !== 0 ||
    (process.getuid !== undefined && info.uid !== process.getuid())) {
    throw new Error("project contexts require an owner-owned private regular file and directory");
  }
}

async function privateDirectory(home: string, create: boolean): Promise<void> {
  if (create) await mkdir(home, { recursive: true, mode: 0o700 });
  const handle = await open(home, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { privateStat(await handle.stat(), true); } finally { await handle.close(); }
}

export async function loadProjectContexts(home = pathsFor().home): Promise<ProjectContext[]> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(pathsFor(home).projectContexts, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error("cannot securely open project contexts");
  }
  try {
    await privateDirectory(home, false);
    const info = await handle.stat();
    privateStat(info);
    if (info.size > MAX_BYTES) throw new Error("project contexts exceed 64 KiB");
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size > MAX_BYTES) throw new Error("project contexts exceed 64 KiB");
    const parsed = ContextFile.safeParse(JSON.parse(bytes.subarray(0, size).toString("utf8")) as unknown);
    if (!parsed.success) throw new Error("invalid project contexts");
    return parsed.data.entries;
  } catch { throw new Error("invalid or unsafe project contexts file"); }
  finally { await handle.close(); }
}

/** Full exact-cwd record CAS; unrelated entries do not invalidate the preview. */
export function projectContextRevision(cwd: string, entry?: ProjectContext): string {
  return createHash("sha256").update(JSON.stringify(entry
    ? ["project-context-v1", entry.cwd, entry.remote, entry.project_key]
    : ["project-context-absent-v1", cwd])).digest("hex");
}

export async function updateProjectContext(home: string, cwd: string, entry: ProjectContext | undefined, expectedRevision: string,
  verify: () => Promise<void> = async () => {}): Promise<void> {
  if (entry) { ProjectContext.parse(entry); if (entry.cwd !== cwd) throw new Error("project context cwd mismatch"); }
  if (!isAbsolute(cwd) || !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error("valid cwd and preview revision required");
  await privateDirectory(home, true);
  const path = pathsFor(home).projectContexts;
  const lockPath = `${path}.lock`;
  let lock: Awaited<ReturnType<typeof open>>;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error("project context writer lock unavailable; inspect any retained lock explicitly"); }
  let temporary: string | undefined;
  try {
    privateStat(await lock.stat());
    const entries = await loadProjectContexts(home);
    if (projectContextRevision(cwd, entries.find(value => value.cwd === cwd)) !== expectedRevision) throw new Error("project context revision conflict; preview again");
    await verify();
    const next = entries.filter(value => value.cwd !== cwd);
    if (entry) next.push(entry);
    const contents = JSON.stringify(ContextFile.parse({ version: 1, entries: next }), null, 2) + "\n";
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error("project contexts exceed 64 KiB");
    const candidate = join(home, `.project-contexts-${randomUUID()}.tmp`);
    const output = await open(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporary = candidate;
    try { privateStat(await output.stat()); await output.writeFile(contents); await output.sync(); }
    finally { await output.close(); }
    await rename(temporary, path);
    temporary = undefined;
    const directory = await open(home, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    try { if (temporary) await unlink(temporary); }
    finally {
      try {
        const owned = await lock.stat();
        const current = await lstat(lockPath).catch(error => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
          throw error;
        });
        if (current && current.dev === owned.dev && current.ino === owned.ino) await unlink(lockPath);
      } finally { await lock.close(); }
    }
  }
}
