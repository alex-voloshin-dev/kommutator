import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initialize, mergeClaudeHooks, mergeCodexHooks } from "../src/init.js";
import { terminalMessage } from "../src/commands.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("local CLI setup and origin", () => {
  it("merges hooks idempotently while retaining unrelated settings and inbound policy", () => {
    const original = { crossSessionInbound: "hold", permissions: { allow: ["Read"] }, hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "other-hook" }, { type: "command", command: "kom", args: ["hook", "Stop"] }] }] } };
    const merged = mergeClaudeHooks(original);
    expect(merged.crossSessionInbound).toBe("hold");
    expect(merged.permissions).toEqual(original.permissions);
    expect(JSON.stringify(merged)).toContain("other-hook");
    expect(mergeClaudeHooks(merged)).toEqual(merged);
    expect(mergeClaudeHooks({})).not.toHaveProperty("crossSessionInbound");
  });

  it("writes mode600 configuration and uses explicit temporary vendor settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kom-init-")); dirs.push(dir);
    const settings = join(dir, "settings.json");
    await writeFile(settings, JSON.stringify({ crossSessionInbound: "default" }));
    const result = await initialize({ home: join(dir, "kom"), hub: "http://127.0.0.1:8787", key: "local-test-key-not-secret", host: "My-Mac", claudeSettings: settings });
    expect(JSON.parse(await readFile(result.config, "utf8"))).toMatchObject({ host: "my-mac" });
    expect((await stat(result.config)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "kom"))).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(result)).not.toContain("local-test-key");
    expect(JSON.parse(await readFile(settings, "utf8")).crossSessionInbound).toBe("default");
  });

  it("grants human force_wake only to a terminal", () => {
    expect(terminalMessage("author@mac", "hello", true, true).message).toMatchObject({ origin: "human", force_wake: true });
    expect(terminalMessage("author@mac", "hello", true, false).message).toMatchObject({ origin: "agent", force_wake: false });
  });
});


describe("Codex opt-in setup", () => {
  it("merges explicit Codex hooks once and preserves unrelated hooks", () => {
    const original = { hooks: { Stop: [{ hooks: [{ type: "command", command: "user-hook" }, { type: "command", command: "kom hook Stop" }] }] }, custom: true };
    const merged = mergeCodexHooks(original);
    expect(mergeCodexHooks(merged)).toEqual(merged);
    expect(JSON.stringify(merged)).toContain("user-hook");
    expect(JSON.stringify(merged)).toContain("kom hook Stop --vendor codex");
    expect(merged.custom).toBe(true);
  });
  it("selects only the Codex hook file and never edits TOML or Claude settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kom-init-codex-")); dirs.push(dir);
    const hooks = join(dir, "hooks.json");
    const claude = join(dir, "claude.json");
    await writeFile(claude, "unchanged");
    const result = await initialize({ home: join(dir, "kom"), key: "local-test-key-not-secret", vendor: "codex", codexHooks: hooks, claudeSettings: claude });
    expect(result.codexHooks).toBe(hooks);
    expect(result.next?.[0]).toBe("codex mcp add kommutator -- kom mcp");
    expect((await stat(hooks)).mode & 0o777).toBe(0o600);
    expect(await readFile(claude, "utf8")).toBe("unchanged");
  });
});
