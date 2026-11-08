import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

it.each([undefined, "claude-code", "codex"])("renders daemon help without internal paths or lifecycle effects (profile %s)", async (profile) => {
  const home = await mkdtemp(join(tmpdir(), "kom-help-"));
  try {
    // Citty uses consola, which suppresses help when it inherits NODE_ENV=test.
    const env = { ...process.env, KOM_HOME: home, NODE_ENV: "production", CONSOLA_LEVEL: "3" };
    delete env.KOM_PLUGIN_PROFILE;
    if (profile) env.KOM_PLUGIN_PROFILE = profile;
    for (const args of [["daemon", "--help"], ["daemon", "run", "--help"], ["daemon", "stop", "--help"], ["daemon", "restart", "--help"]]) {
      const { stdout, stderr } = await execute(process.execPath, [entry, ...args], { env, timeout: 5000 });
      expect(stdout).toContain(args.length === 2 ? "kom daemon" : `daemon ${args[1]}`);
      expect(stdout).not.toContain(entry);
      expect(stdout).not.toContain("dist/index.js");
      expect(stderr).toBe("");
    }
    expect(await readdir(home)).toEqual([]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

it("renders board help and rejects missing selections without starting a daemon", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-board-help-"));
  try {
    const env = { ...process.env, KOM_HOME: home, NODE_ENV: "production", CONSOLA_LEVEL: "3" };
    for (const args of [["board", "--help"], ["board", "get", "--help"], ["board", "list", "--help"]]) {
      const { stdout, stderr } = await execute(process.execPath, [entry, ...args], { env, timeout: 5000 });
      expect(stdout).toContain(args.length === 2 ? "get" : "--session");
      expect(stdout).not.toContain("dist/index.js");
      expect(stderr).toBe("");
    }
    await expect(execute(process.execPath, [entry, "board", "get", "--topic", "global", "--key", "decisions"], { env, timeout: 5000 })).rejects.toThrow();
    await expect(execute(process.execPath, [entry, "board", "list", "--session", "missing", "--topic", "global"], { env, timeout: 5000 })).rejects.toThrow();
    expect(await readdir(home)).toEqual([]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
