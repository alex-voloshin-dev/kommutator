import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/** Read-only conflict detection: never rewrite vendor trust or unrelated settings. */
export async function pluginConflicts(profile: string, cwd?: string): Promise<string[]> {
  const home = homedir();
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const candidates = profile === "codex"
    ? [join(process.env.CODEX_HOME ?? join(home, ".codex"), "hooks.json"), join(process.env.CODEX_HOME ?? join(home, ".codex"), "config.toml"), ...(cwd ? [join(cwd, ".codex/hooks.json"), join(cwd, ".codex/config.toml")] : [])]
    : [join(claudeHome, "settings.json"), join(home, ".claude.json"), ...(cwd ? [join(cwd, ".claude/settings.json"), join(cwd, ".claude/settings.local.json"), join(cwd, ".mcp.json")] : [])];
  const conflicts: string[] = [];
  for (const file of candidates) {
    try {
      const text = await readFile(file, "utf8");
      if (/\bkom\s+(hook|mcp)\b|"command"\s*:\s*"kom"|packages[\\/]cli[\\/]dist[\\/]index\.js["\s]+(?:hook|mcp)|\[mcp_servers\.(?:"kommutator"|kommutator)\]|"kommutator"\s*:\s*\{/.test(text)) conflicts.push(file);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw new Error("Cannot inspect existing vendor integration settings");
    }
  }
  return conflicts;
}
