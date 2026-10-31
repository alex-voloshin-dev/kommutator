import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pluginConflicts } from "../src/plugin-conflicts.js";

let home: string;
let project: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "kom-plugin-conflict-"));
  project = join(home, "project");
  vi.stubEnv("HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, "claude"));
  vi.stubEnv("CODEX_HOME", join(home, "codex"));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
async function settings(path: string, data: unknown): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof data === "string" ? data : JSON.stringify(data));
  return path;
}
it("allows its installed marketplace and enabled plugin without modifying vendor settings", async () => {
  const path = await settings(join(home, "claude/settings.json"), {
    extraKnownMarketplaces: { kommutator: { source: { source: "github", repo: "alex-voloshin-dev/kommutator" } } },
    enabledPlugins: { "kommutator@kommutator": true },
  });
  const before = await readFile(path, "utf8");
  expect(await pluginConflicts("claude-code", project)).toEqual([]);
  expect(await readFile(path, "utf8")).toBe(before);
});
it("ignores integration-looking descriptions, permission rules and marketplace commands", async () => {
  await settings(join(home, "claude/settings.json"), {
    permissions: { allow: ["Bash(kom mcp)"] },
    description: "kom hook Stop",
    extraKnownMarketplaces: { kommutator: { source: { command: "kom mcp" } } },
  });
  expect(await pluginConflicts("claude-code", project)).toEqual([]);
});
it.each([
  { mcpServers: { kommutator: { command: "/some/custom-launcher" } } },
  { mcpServers: { legacy: { command: "kom", args: ["mcp"] } } },
  { mcpServers: { legacy: { command: "node", args: ["/repo/packages/cli/dist/index.js", "mcp"] } } },
  { hooks: { Stop: [{ hooks: [{ type: "command", command: "kom", args: ["hook", "Stop"] }] }] } },
  { hooks: { Stop: [{ hooks: [{ type: "command", command: "exec '/opt/bin/kom' hook Stop" }] }] } },
  { hooks: { Stop: [{ hooks: [{ type: "command", command: "node /repo/packages/cli/dist/index.js hook Stop" }] }] } },
  { hooks: { Stop: [{ hooks: [{ type: "command", command: "kom hook Stop; true" }] }] } },
  { mcpServers: { legacy: { command: "sh", args: ["-c", "kom mcp;"] } } },
])("still rejects actual manual MCP/hook configuration %#", async value => {
  const path = await settings(join(home, "claude/settings.json"), value);
  expect(await pluginConflicts("claude-code", project)).toEqual([path]);
});
it("checks project MCP files and the current project's nested Claude state", async () => {
  const state = await settings(join(home, ".claude.json"), {
    projects: { [project]: { mcpServers: { kommutator: { command: "kom" } } } },
  });
  const local = await settings(join(project, ".mcp.json"), { mcpServers: { kommutator: { command: "kom" } } });
  expect(await pluginConflicts("claude-code", project)).toEqual([state, local]);
});
it("does not let another project's manual integration block this project", async () => {
  await settings(join(home, ".claude.json"), { projects: { "/other": { mcpServers: { kommutator: { command: "kom" } } } } });
  expect(await pluginConflicts("claude-code", project)).toEqual([]);
});
it.each(['{"key":"do-not-disclose",', '[]', '{"hooks":42}', '{"mcpServers":[]}'])("fails closed with redacted errors for malformed settings %#", async text => {
  await settings(join(home, "claude/settings.json"), text);
  await expect(pluginConflicts("claude-code", project)).rejects.toThrow(/^Cannot inspect existing vendor integration settings$/);
});
it("accepts Codex marketplace metadata but detects manual hooks", async () => {
  await settings(join(home, "codex/config.toml"), '[plugins."kommutator@kommutator"]\nenabled = true\n');
  expect(await pluginConflicts("codex", project)).toEqual([]);
  const path = await settings(join(home, "codex/hooks.json"), { hooks: { Stop: [{ hooks: [{ type: "command", command: "kom hook Stop --vendor codex" }] }] } });
  expect(await pluginConflicts("codex", project)).toEqual([path]);
});
it.each([
  '[mcp_servers.kommutator]\ncommand = "custom"',
  "[mcp_servers.'kommutator']\ncommand = 'custom'",
  '[mcp_servers."kommutator"]\ncommand = "custom"',
  '[mcp_servers.alias]\ncommand = "sh"\nargs = [\n  "-c",\n  "kom mcp",\n]',
  'notes = "ok" # """\n[mcp_servers.kommutator]\ncommand = "kom"',
])("preserves conservative detection of manually declared Codex MCP servers %#", async text => {
  const path = await settings(join(home, "codex/config.toml"), text);
  expect(await pluginConflicts("codex", project)).toEqual([path]);
});
it("detects actual manual integration alongside legitimate marketplace metadata", async () => {
  const path = await settings(join(home, "claude/settings.json"), {
    extraKnownMarketplaces: { kommutator: { source: { repo: "alex-voloshin-dev/kommutator" } } },
    enabledPlugins: { "kommutator@kommutator": true },
    hooks: { Stop: [{ hooks: [{ type: "command", command: "kom hook Stop" }] }] },
  });
  expect(await pluginConflicts("claude-code", project)).toEqual([path]);
});
it("does not let TOML comments hide a following manual server", async () => {
  const path = await settings(join(home, "codex/config.toml"), '# """\n[mcp_servers.kommutator]\ncommand = "kom"');
  expect(await pluginConflicts("codex", project)).toEqual([path]);
});
it("does not treat non-command prompt hooks as executable legacy hooks", async () => {
  await settings(join(home, "claude/settings.json"), {
    hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "Explain how kom hook Stop and kom mcp work" }] }] },
  });
  expect(await pluginConflicts("claude-code", project)).toEqual([]);
});
it("redacts filesystem inspection errors without changing the settings path", async () => {
  const path = join(home, "claude/settings.json");
  await mkdir(path, { recursive: true });
  await expect(pluginConflicts("claude-code", project)).rejects.toThrow(/^Cannot inspect existing vendor integration settings$/);
  await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "EISDIR" });
});
