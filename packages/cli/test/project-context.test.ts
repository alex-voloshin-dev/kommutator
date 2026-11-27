import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContexts } from "@kommutator/agentd";
import { manageProjectContext } from "../src/project-context.js";

const homes: string[] = [];
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))); });
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "kom-cli-context-")); homes.push(home);
  const cwd = join(home, "checkout");
  const git = promisify(execFile);
  await git("git", ["init", "--quiet", cwd]);
  await git("git", ["-C", cwd, "remote", "add", "origin", "https://user:secret@github.com/example/context.git?token=secret"]);
  return { home, cwd, git };
}

describe("project-context CLI", () => {
  it("previews without writing, applies with full-record revision and removes deleted-checkout selections", async () => {
    const { home, cwd } = await fixture();
    const options = { cwd, remote: "github.com/example/context", project: "legacy" };
    const preview = await manageProjectContext("select", options, home);
    expect(preview).toMatchObject({ applied: false, cwd, prior: null, topic: "project:legacy" });
    expect(JSON.stringify(preview)).not.toContain("secret");
    await expect(readFile(join(home, "project-contexts.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(manageProjectContext("select", { ...options, apply: true }, home)).rejects.toThrow("expect-revision");
    await manageProjectContext("select", { ...options, apply: true, expectRevision: preview.revision }, home);
    expect(await loadProjectContexts(home)).toEqual([{ cwd, remote: options.remote, project_key: "legacy" }]);
    await expect(manageProjectContext("select", { ...options, apply: true, expectRevision: preview.revision }, home)).rejects.toThrow("revision conflict");
    await rm(cwd, { recursive: true });
    const removal = await manageProjectContext("remove", { cwd }, home);
    expect(removal.prior?.project_key).toBe("legacy");
    await manageProjectContext("remove", { cwd, apply: true, expectRevision: removal.revision }, home);
    expect(await loadProjectContexts(home)).toEqual([]);
  });
  it("fails closed on changed or unavailable remote without printing credentials", async () => {
    const { home, cwd, git } = await fixture();
    const options = { cwd, remote: "github.com/example/context", project: "legacy" };
    const preview = await manageProjectContext("select", options, home);
    await git("git", ["-C", cwd, "remote", "set-url", "origin", "https://private:secret@github.com/example/changed.git"]);
    await expect(manageProjectContext("select", { ...options, apply: true, expectRevision: preview.revision }, home)).rejects.toThrow("Git origin unavailable or differs");
    await git("git", ["-C", cwd, "remote", "remove", "origin"]);
    await expect(manageProjectContext("select", options, home)).rejects.toThrow("Git origin unavailable or differs");
    expect(await loadProjectContexts(home)).toEqual([]);
  });
});
