import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../src/daemon.js";
import { loadProjectContexts, projectContextRevision, updateProjectContext, type ProjectContext } from "../src/project-contexts.js";

vi.mock("node:crypto", async importOriginal => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function home() { const result = await mkdtemp(join(tmpdir(), "kom-context-")); homes.push(result); return result; }
const entry: ProjectContext = { cwd: "/checkout", remote: "github.com/owner/repo", project_key: "legacy" };
const contents = (entries: unknown[], version = 1) => JSON.stringify({ version, entries });

describe("private project contexts", () => {
  it("fails startup for invalid existing selection and treats a missing file as no selection", async () => {
    const dir = await home();
    await chmod(dir, 0o755);
    expect(await loadProjectContexts(dir)).toEqual([]);
    await chmod(dir, 0o700);
    await writeFile(join(dir, "project-contexts.json"), "invalid", { mode: 0o600 });
    await expect(startDaemon({ home: dir, config: { host: "test", hub: "http://localhost:8787", key: "test-key-sixteen-characters" } })).rejects.toThrow("invalid or unsafe");
    await expect(stat(join(dir, "state.db"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("writes private atomic selections, preserves unrelated entries, and removes by full-entry CAS", async () => {
    const dir = await home();
    expect(await loadProjectContexts(dir)).toEqual([]);
    const initial = projectContextRevision(entry.cwd);
    await updateProjectContext(dir, entry.cwd, entry, initial);
    const second = { ...entry, cwd: "/other" };
    await updateProjectContext(dir, second.cwd, second, projectContextRevision(second.cwd));
    const changed = { ...entry, remote: "github.com/owner/changed" };
    await updateProjectContext(dir, entry.cwd, changed, projectContextRevision(entry.cwd, entry));
    await expect(updateProjectContext(dir, entry.cwd, undefined, projectContextRevision(entry.cwd, entry))).rejects.toThrow("revision conflict");
    expect(await loadProjectContexts(dir)).toEqual([second, changed]);
    await updateProjectContext(dir, entry.cwd, undefined, projectContextRevision(entry.cwd, changed));
    expect(await loadProjectContexts(dir)).toEqual([second]);
    expect((await stat(join(dir, "project-contexts.json"))).mode & 0o777).toBe(0o600);
  });
  it.each([
    "{", contents([], 2), contents([entry, entry]), contents([{ ...entry, extra: true }]),
    contents([{ ...entry, cwd: "relative" }]), contents([{ ...entry, project_key: "" }]),
    contents([{ ...entry, remote: "https://user:secret@github.com/owner/repo" }]),
    contents(Array.from({ length: 129 }, (_, index) => ({ ...entry, cwd: `/checkout-${index}` }))),
    " ".repeat(65537),
  ])("rejects malformed or unbounded files", async body => {
    const dir = await home();
    await writeFile(join(dir, "project-contexts.json"), body, { mode: 0o600 });
    await expect(loadProjectContexts(dir)).rejects.toThrow();
  });
  it("rejects unsafe permissions, symlinks and nonregular files without replacing them", async () => {
    const dir = await home();
    const path = join(dir, "project-contexts.json");
    await writeFile(path, contents([entry]), { mode: 0o644 });
    await expect(loadProjectContexts(dir)).rejects.toThrow();
    await expect(updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd))).rejects.toThrow();
    await chmod(path, 0o600);
    expect(await loadProjectContexts(dir)).toEqual([entry]);
    await rm(path);
    const target = join(dir, "target");
    await writeFile(target, contents([entry]), { mode: 0o600 });
    await symlink(target, path);
    await expect(loadProjectContexts(dir)).rejects.toThrow();
    await expect(updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd))).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(contents([entry]));
    await rm(path);
    await mkdir(path, { mode: 0o700 });
    await expect(loadProjectContexts(dir)).rejects.toThrow();
  });
  it("refuses an exclusively created temporary-file collision without changing either file", async () => {
    const dir = await home();
    const collision = join(dir, ".project-contexts-11111111-1111-4111-8111-111111111111.tmp");
    await writeFile(collision, "do not overwrite", { mode: 0o600 });
    await expect(updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(collision, "utf8")).toBe("do not overwrite");
    expect(await loadProjectContexts(dir)).toEqual([]);
    await rm(collision);
    await updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd));
    expect(await loadProjectContexts(dir)).toEqual([entry]);
  });
  it("leaves a replacement writer lock owned by another invocation intact", async () => {
    const dir = await home();
    const lock = join(dir, "project-contexts.json.lock");
    await updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd), async () => {
      await rm(lock);
      await writeFile(lock, "replacement", { mode: 0o600 });
    });
    expect(await readFile(lock, "utf8")).toBe("replacement");
  });
  it("serializes writers, never reclaims retained locks, and cleans its own lock after verification failure", async () => {
    const dir = await home();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    const first = updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd), async () => { entered(); await waiting; });
    await acquired;
    await expect(updateProjectContext(dir, entry.cwd, entry, projectContextRevision(entry.cwd))).rejects.toThrow("lock unavailable");
    release(); await first;
    await expect(updateProjectContext(dir, entry.cwd, undefined, projectContextRevision(entry.cwd, entry), async () => { throw new Error("origin changed"); })).rejects.toThrow("origin changed");
    expect(await loadProjectContexts(dir)).toEqual([entry]);
    const lock = join(dir, "project-contexts.json.lock");
    await writeFile(lock, "retained", { mode: 0o600 });
    await expect(updateProjectContext(dir, entry.cwd, undefined, projectContextRevision(entry.cwd, entry))).rejects.toThrow("lock unavailable");
    expect(await readFile(lock, "utf8")).toBe("retained");
  });
});
