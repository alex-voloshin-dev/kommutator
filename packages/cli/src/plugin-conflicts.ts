import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function manualCommand(value: unknown): boolean {
  if (!object(value) || typeof value.command !== "string") return false;
  const command = value.command;
  if (/(?:^|[\\/])kom(?:\.exe)?$/.test(command)) return true;
  const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string") : [];
  const line = [command, ...args].join(" ");
  return /(?:^|[\s"';&|])(?:[^\s"']*[\\/])?kom["']?\s+(?:hook|mcp)\b|packages[\\/]cli[\\/]dist[\\/]index\.js["'\s]+(?:hook|mcp)\b/.test(line);
}

function jsonIntegration(value: JsonObject): boolean {
  if (value.mcpServers !== undefined) {
    if (!object(value.mcpServers)) throw new Error("Invalid MCP settings");
    if (Object.entries(value.mcpServers).some(([name, server]) => name === "kommutator" || manualCommand(server))) return true;
  }
  if (value.hooks !== undefined) {
    if (!object(value.hooks)) throw new Error("Invalid hook settings");
    for (const groups of Object.values(value.hooks)) {
      if (!Array.isArray(groups)) throw new Error("Invalid hook groups");
      for (const group of groups) {
        if (!object(group) || !Array.isArray(group.hooks)) throw new Error("Invalid hook group");
        if (group.hooks.some((hook: unknown) => object(hook) && (hook.type === undefined || hook.type === "command") && manualCommand(hook))) return true;
      }
    }
  }
  return false;
}

function jsonConflict(text: string, projectSettings: boolean, cwd?: string): boolean {
  const value: unknown = JSON.parse(text);
  if (!object(value)) throw new Error("Invalid settings object");
  if (jsonIntegration(value)) return true;
  // ~/.claude.json also stores local-scoped MCP entries under the exact project path.
  // Other projects and marketplace/plugin metadata do not execute in this session.
  if (projectSettings && cwd && value.projects !== undefined) {
    if (!object(value.projects)) throw new Error("Invalid project settings");
    const project = value.projects[cwd];
    if (project !== undefined) {
      if (!object(project)) throw new Error("Invalid project settings");
      return jsonIntegration(project);
    }
  }
  return false;
}

function tomlConflict(text: string): boolean {
  // Preserve the existing conservative TOML detection. The marketplace false positive
  // is in JSON; do not introduce a partial TOML parser that could miss manual servers.
  return /\bkom\s+(hook|mcp)\b|"command"\s*:\s*"kom"|packages[\\/]cli[\\/]dist[\\/]index\.js["\s]+(?:hook|mcp)|\[mcp_servers\.(?:"kommutator"|'kommutator'|kommutator)\]/.test(text);
}

/** Read-only conflict detection: never rewrite vendor trust or unrelated settings. */
export async function pluginConflicts(profile: string, cwd?: string): Promise<string[]> {
  const home = homedir();
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const claudeState = join(home, ".claude.json");
  const candidates = profile === "codex"
    ? [join(process.env.CODEX_HOME ?? join(home, ".codex"), "hooks.json"), join(process.env.CODEX_HOME ?? join(home, ".codex"), "config.toml"), ...(cwd ? [join(cwd, ".codex/hooks.json"), join(cwd, ".codex/config.toml")] : [])]
    : [join(claudeHome, "settings.json"), claudeState, ...(cwd ? [join(cwd, ".claude/settings.json"), join(cwd, ".claude/settings.local.json"), join(cwd, ".mcp.json")] : [])];
  const conflicts: string[] = [];
  for (const file of candidates) {
    try {
      const text = await readFile(file, "utf8");
      if (file.endsWith(".toml") ? tomlConflict(text) : jsonConflict(text, file === claudeState, cwd)) conflicts.push(file);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error("Cannot inspect existing vendor integration settings");
    }
  }
  return conflicts;
}
