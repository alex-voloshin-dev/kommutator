import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
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

const cliEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ProcessPreview = z.object({ applied: z.boolean(), revision: z.string(), cwd: z.string(), topic: z.string().nullable() });

it("executes built CLI preview/apply/CAS/removal without daemon startup or credential output", async () => {
  const { home, cwd } = await fixture();
  const run = (...args: string[]) => promisify(execFile)(process.execPath, [cliEntry, ...args], {
    env: { ...process.env, KOM_HOME: home, NODE_ENV: "production" }, timeout: 5000,
  });
  const select = ["project-context", "select", "--cwd", cwd, "--remote", "github.com/example/context", "--project", "legacy"];
  const output = await run(...select);
  const preview = ProcessPreview.parse(JSON.parse(output.stdout));
  expect(preview).toMatchObject({ applied: false, cwd, topic: "project:legacy" });
  expect(output.stdout + output.stderr).not.toContain("secret");
  await expect(readFile(join(home, "project-contexts.json"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(run(...select, "--apply")).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("expect-revision") });
  const applied = await run(...select, "--apply", "--expect-revision", preview.revision);
  expect(ProcessPreview.parse(JSON.parse(applied.stdout)).applied).toBe(true);
  await expect(run(...select, "--apply", "--expect-revision", preview.revision)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("revision conflict") });
  expect(await loadProjectContexts(home)).toEqual([{ cwd, remote: "github.com/example/context", project_key: "legacy" }]);
  await rm(cwd, { recursive: true });
  const remove = ["project-context", "remove", "--cwd", cwd];
  const removal = ProcessPreview.parse(JSON.parse((await run(...remove)).stdout));
  await run(...remove, "--apply", "--expect-revision", removal.revision);
  expect(await loadProjectContexts(home)).toEqual([]);
  for (const path of ["agentd.json", "agentd.sock", "state.db"]) {
    await expect(readFile(join(home, path))).rejects.toMatchObject({ code: "ENOENT" });
  }
}, 15_000);

it("fails built daemon startup on malformed selections before creating runtime state", async () => {
  const { home } = await fixture();
  await writeFile(join(home, "config.json"), JSON.stringify({ host: "qa", hub: "http://127.0.0.1:1", key: "test-key-sixteen-characters" }), { mode: 0o600 });
  await writeFile(join(home, "project-contexts.json"), "{", { mode: 0o600 });
  await expect(promisify(execFile)(process.execPath, [cliEntry, "daemon", "run"], {
    env: { ...process.env, KOM_HOME: home, NODE_ENV: "production" }, timeout: 5000,
  })).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining("invalid or unsafe project contexts file") });
  for (const path of ["agentd.json", "agentd.sock", "state.db"]) {
    await expect(readFile(join(home, path))).rejects.toMatchObject({ code: "ENOENT" });
  }
});
