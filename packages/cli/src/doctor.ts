import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { Config, pathsFor } from "@kommutator/agentd";
import { Ident, MAX_FRAME_BYTES, PROTOCOL_VERSION } from "@kommutator/protocol";
import * as z from "zod";
import { IpcClient, cliHello, type RpcClient } from "./ipc-client.js";

type State = "pass" | "warning" | "fail" | "unknown" | "not_configured";
export interface DoctorCheck { id: string; state: State; summary: string; remedy?: string }
export interface DoctorOptions {
  home?: string;
  cwd?: string;
  userHome?: string;
  claudeSettings?: string;
  codexHooks?: string;
  pluginDir?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}
interface Probes {
  client?: () => RpcClient;
  fetch?: typeof fetch;
  guiPath?: () => Promise<string | undefined>;
}
const object = z.record(z.string(), z.unknown());
const events = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"];
const Diagnostics = z.object({ claude_sessions: z.array(z.object({ id: z.string(), endpoint_configured: z.boolean(), socket_present: z.boolean().nullable() })),
  codex_sessions: z.array(z.object({ id: z.string(), shim_alive: z.boolean(), hook_events: z.array(z.enum(["UserPromptSubmit", "PostToolUse", "Stop"])) })).optional(),
});
const Snapshot = z.object({ protocol_version: z.number(), hosts: z.array(z.unknown()), sessions: z.array(z.unknown()), deliveries: z.array(z.unknown()) });
function parsedConfig(value: unknown) {
  // Config's URL refinement may throw for malformed URLs; diagnostics never expose it.
  try { const parsed = Config.safeParse(value); return parsed.success ? parsed.data : undefined; }
  catch { return undefined; }
}

function isKomCommand(value: unknown): value is string {
  return typeof value === "string" && (value === "kom" || (isAbsolute(value) && (basename(value) === "kom" || value.endsWith("/packages/cli/dist/index.js"))));
}

async function isExecutableFile(path: string): Promise<boolean> {
  try { if (!(await stat(path)).isFile()) return false; await access(path, constants.X_OK); return true; }
  catch { return false; }
}

function check(id: string, state: State, summary: string, remedy?: string): DoctorCheck {
  return { id, state, summary, ...(remedy ? { remedy } : {}) };
}

/** Limits each independent check; callers close IPC and abort HTTP in their finally blocks. */
async function deadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("diagnostic deadline")), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

async function jsonFile(path: string): Promise<unknown | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FRAME_BYTES) throw new Error("unsupported configuration file");
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function executableOnPath(value: string | undefined, cwd: string): Promise<boolean> {
  if (value === undefined) return false;
  for (const directory of value.split(delimiter)) {
    const candidate = resolve(cwd, directory || ".", "kom");
    if (await isExecutableFile(candidate)) return true;
  }
  return false;
}

function launchdPath(timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolvePath) => {
    // A fixed system executable only. Never run a discovered kom binary or hook command.
    execFile("/bin/launchctl", ["getenv", "PATH"], { timeout: timeoutMs, maxBuffer: 16_384, encoding: "utf8" }, (error, stdout) => {
      resolvePath(error || !stdout.trim() ? undefined : stdout.trim());
    });
  });
}

async function hookWiring(id: string, paths: string[], vendor: "claude" | "codex"): Promise<DoctorCheck> {
  const seen = new Set<string>();
  let found = false;
  let conditional = false;
  let missingExecutable = false;
  for (const path of [...new Set(paths)]) {
    const value = await jsonFile(path);
    if (value === undefined) continue;
    found = true;
    const settings = object.parse(value);
    if (settings.disableAllHooks === true) return check(id, "warning", "Hooks are disabled in an inspected settings file.", "Review the vendor settings before enabling hooks.");
    const hooks = object.parse(settings.hooks ?? {});
    for (const event of events) {
      const groups = z.array(object).parse(hooks[event] ?? []);
      for (const group of groups) for (const value of z.array(object).parse(group.hooks ?? [])) {
        const direct = isKomCommand(value.command) && Array.isArray(value.args) && value.args.length === 2 && value.args[0] === "hook" && value.args[1] === event;
        const shell = value.command === `kom hook ${event}${vendor === "codex" ? " --vendor codex" : ""}` && value.args === undefined;
        if (value.type !== "command" || (!(direct && vendor === "claude") && !shell)) continue;
        if (direct && typeof value.command === "string" && isAbsolute(value.command) && !await isExecutableFile(value.command)) missingExecutable = true;
        if (vendor === "claude" && shell) conditional = true;
        if (group.matcher !== undefined && group.matcher !== "" && group.matcher !== ".*" && group.matcher !== "*") conditional = true;
        seen.add(event);
      }
    }
  }
  if (!found || seen.size === 0) return check(id, "not_configured", "No kommutator hook commands found in the inspected vendor files.", vendor === "claude" ? "Run kom init, or inspect a launch plugin with --plugin-dir; loading it remains a separate step." : "Run kom init --vendor codex, add the MCP server, and review hook trust with /hooks.");
  const missing = events.filter((event) => !seen.has(event));
  if (missing.length) return check(id, "warning", `Missing hook commands: ${missing.join(", ")}.`, "Review the vendor hook file against the shipped template.");
  if (missingExecutable) return check(id, "warning", "Hook commands are configured, but an absolute kom executable is missing or inaccessible.", "Build or restore the configured executable and verify its Node interpreter.");
  if (conditional) return check(id, "warning", "All hook commands found, but matchers or Claude shell-form commands can prevent correct session binding.", "Use the shipped exec-form Claude hooks and review event matchers.");
  return check(id, vendor === "codex" ? "warning" : "pass", vendor === "codex" ? "Codex hook commands and vendor markers configured; hook trust, feature overrides, MCP metadata and runtime firing still require a live root-session check." : "All five hook commands configured; runtime firing and vendor overrides remain unverified.");
}

function clientFor(options: DoctorOptions, timeoutMs: number): RpcClient {
  return new IpcClient({ hello: cliHello, endpoint: pathsFor(options.home).ipc, timeoutMs, lazyStart: false, retries: 0 });
}

/** No lazy start, SQLite access, configuration writes, socket delivery, or hook execution. */
export async function runDoctor(options: DoctorOptions = {}, probes: Probes = {}) {
  const timeoutMs = z.number().int().min(50).max(10_000).parse(options.timeoutMs ?? 1_500);
  const cwd = options.cwd ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const checks: Array<Promise<DoctorCheck>> = [];
  const add = (id: string, work: () => Promise<DoctorCheck>): void => {
    checks.push(deadline(Promise.resolve().then(work), timeoutMs).catch(() => check(id, "unknown", "Check failed, timed out, or returned invalid data.", "Check file permissions and configuration; retry with --timeout-ms if needed.")));
  };
  // Share the read, including failures, so bad configuration cannot hide the other checks.
  const configFile = deadline(jsonFile(pathsFor(options.home).config), timeoutMs).then((value) => ({ value }), () => ({ value: undefined, failed: true }));
  add("config", async () => {
    const file = await configFile;
    if ("failed" in file) return check("config", "fail", "Daemon configuration could not be read or parsed.", "Review the private config.json; kom init can repair configuration.");
    if (file.value === undefined) return check("config", "not_configured", "Daemon configuration is absent.", "Run kom init with the hub URL and KOM_KEY in the environment.");
    return parsedConfig(file.value) ? check("config", "pass", "Daemon configuration is valid.") : check("config", "fail", "Daemon configuration has an invalid hub URL, key or host.", "Review config.json or run kom init.");
  });
  add("host", async () => {
    const file = await configFile;
    const parsed = object.safeParse(file.value);
    if (!parsed.success) return check("host", "unknown", "Host cannot be checked without readable configuration.");
    return Ident.safeParse(parsed.data.host).success ? check("host", "pass", "Configured host satisfies the shared identifier grammar.") : check("host", "fail", "Host must match [a-z0-9][a-z0-9_-]{0,62}.", "Set a valid short host with kom init --host.");
  });
  add("path.current", async () => await executableOnPath(env.PATH, cwd) ? check("path.current", "pass", "An executable kom file resolves on the current process PATH; it was not executed.") : check("path.current", "fail", "kom does not resolve on the current process PATH.", "Install or link the built kom entrypoint into a PATH directory."));
  add("path.gui", async () => {
    if (platform !== "darwin") return check("path.gui", "unknown", "GUI application PATH inspection is only implemented for macOS.");
    const path = await (probes.guiPath?.() ?? launchdPath(timeoutMs));
    if (!path) return check("path.gui", "unknown", "launchd has no explicit readable PATH; a GUI application's inherited PATH is unknown.", "Verify kom from the target application's launch environment; shell PATH is separate evidence.");
    return await executableOnPath(path, cwd) ? check("path.gui", "warning", "kom resolves on launchd's explicit PATH; its Node interpreter and the actual GUI app environment remain unverified.", "Ensure Node 24 and kom resolve in the target app environment; restart the app and verify MCP or hook startup.") : check("path.gui", "warning", "kom does not resolve on launchd's explicit PATH; the actual GUI app PATH remains unverified.", "Expose Node 24 and kom to the target application's launch environment and restart that app.");
  });
  add("hooks.claude", () => hookWiring("hooks.claude", options.claudeSettings ? [options.claudeSettings] : [join(env.CLAUDE_CONFIG_DIR ?? join(userHome, ".claude"), "settings.json"), join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")], "claude"));
  add("hooks.codex", () => hookWiring("hooks.codex", options.codexHooks ? [options.codexHooks] : [join(env.CODEX_HOME ?? join(userHome, ".codex"), "hooks.json"), join(cwd, ".codex", "hooks.json")], "codex"));
  if (options.pluginDir) {
    const pluginDir = options.pluginDir;
    add("plugin.claude", async () => {
      const manifest = object.parse(await jsonFile(join(pluginDir, ".claude-plugin", "plugin.json")));
      const servers = object.parse(manifest.mcpServers);
      const mcp = object.parse(servers.kommutator);
      if (manifest.name !== "kommutator" || !isKomCommand(mcp.command) || !Array.isArray(mcp.args) || mcp.args.length !== 1 || mcp.args[0] !== "mcp") return check("plugin.claude", "fail", "Plugin does not declare the expected kommutator MCP entrypoint.");
      if (isAbsolute(mcp.command) && !await isExecutableFile(mcp.command)) return check("plugin.claude", "warning", "Plugin MCP command names a missing or inaccessible absolute executable.", "Build or restore the configured executable and verify its Node interpreter.");
      const hooks = await hookWiring("plugin.claude", [join(pluginDir, "hooks", "hooks.json")], "claude");
      return hooks.state === "pass" ? check("plugin.claude", "warning", "Plugin hook and MCP files are valid; this does not establish installation or activation.", "Launch Claude with this --plugin-dir and verify the session's integration.") : hooks;
    });
  }
  const client = probes.client?.() ?? clientFor(options, timeoutMs);
  const ipc = deadline(client.call("daemon.diagnostics"), timeoutMs).then((value) => ({ value: Diagnostics.parse(value) }), () => ({ value: undefined })).catch(() => ({ value: undefined })).finally(() => client.close());
  add("ipc", async () => (await ipc).value ? check("ipc", "pass", "Daemon responded to an owner-local diagnostic request.") : check("ipc", "fail", "Daemon IPC is unavailable or does not support diagnostics.", "Run kom daemon run after kom init, or restart an older daemon; this check never starts it."));
  add("sockets.claude", async () => {
    const value = (await ipc).value;
    if (!value) return check("sockets.claude", "unknown", "Registered Claude sockets cannot be checked while daemon diagnostics are unavailable.");
    if (!value.claude_sessions.length) return check("sockets.claude", "not_configured", "No live registered Claude sessions to inspect.", "Start a Claude session with the integration enabled.");
    const missing = value.claude_sessions.filter((session) => !session.endpoint_configured || session.socket_present === false).length;
    const unknown = value.claude_sessions.filter((session) => session.endpoint_configured && session.socket_present === null).length;
    if (missing) return check("sockets.claude", "fail", `${missing} registered Claude session(s) lack an existing inbox socket.`, "Check SessionStart hook wiring or restart the affected Claude session.");
    if (unknown) return check("sockets.claude", "unknown", `${unknown} registered Claude socket(s) could not be inspected.`, "Check endpoint permissions; no delivery was attempted.");
    return check("sockets.claude", "pass", `${value.claude_sessions.length} registered Claude inbox socket(s) exist; existence is not proof of delivery.`);
  });
  add("runtime.codex", async () => {
    const diagnostics = (await ipc).value;
    if (!diagnostics?.codex_sessions) return check("runtime.codex", "unknown", "Codex runtime diagnostics are unavailable; start or update the daemon.");
    const sessions = diagnostics.codex_sessions;
    if (!sessions.length) return check("runtime.codex", "not_configured", "No live Codex root registered through MCP metadata.", "Start a local Codex root with the MCP server enabled and call whoami.");
    if (sessions.some((session) => !session.shim_alive)) return check("runtime.codex", "fail", "A registered Codex root has no live matching shim process.", "Restart the affected root or wait for daemon lifecycle cleanup.");
    if (sessions.some((session) => !session.hook_events.includes("Stop") || !session.hook_events.includes("PostToolUse"))) return check("runtime.codex", "warning", "Codex identities and shim liveness verified; PostToolUse and Stop polls have not both been observed for every root since daemon start.", "Review hook trust and feature overrides, then exercise a tool and finish a turn.");
    return check("runtime.codex", "pass", `${sessions.length} Codex root(s) have live shims and observed PostToolUse/Stop polls; this does not prove header consumption, native wake or desktop UI support.`);
  });
  add("hub", async () => {
    const config = parsedConfig((await configFile).value);
    if (!config) return check("hub", "unknown", "Authenticated reachability requires valid daemon configuration.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(config.hub);
      if (url.username || url.password) return check("hub", "fail", "Hub URL must not contain embedded credentials.", "Keep the key in private config.json and use a credential-free hub URL.");
      url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = `${url.pathname.replace(/\/$/, "")}/api/snapshot`;
      url.search = ""; url.hash = "";
      const response = await (probes.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${config.key}` }, signal: controller.signal, redirect: "error" });
      if (response.status === 401 || response.status === 403) return check("hub", "fail", "Hub rejected authentication.", "Ensure the daemon and hub use the same KOM_KEY.");
      if (!response.ok || !response.body) return check("hub", "fail", "Hub did not return a successful snapshot.", "Check kom logs and the configured hub service.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_FRAME_BYTES) return check("hub", "warning", "Hub responded successfully, but its snapshot exceeds the diagnostic read limit.");
        chunks.push(chunk);
      }
      const snapshot = Snapshot.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      return snapshot.protocol_version === PROTOCOL_VERSION ? check("hub", "pass", "Authenticated hub snapshot is reachable and has the expected protocol version.") : check("hub", "warning", "Hub responded, but its protocol version differs.", "Align hub and CLI versions.");
    } catch { return check("hub", "fail", "Authenticated hub check failed, timed out, or returned invalid data.", "Check the hub service, URL and key; redirects are not followed."); }
    finally { clearTimeout(timer); controller.abort(); }
  });
  const results = await Promise.all(checks);
  return { ok: !results.some((result) => result.state === "fail"), complete: results.every((result) => result.state === "pass"), checks: results };
}

export async function readStatus(options: Pick<DoctorOptions, "home" | "timeoutMs"> = {}, createClient?: () => RpcClient): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const client = createClient?.() ?? clientFor(options, timeoutMs);
  try { return await deadline(client.call("daemon.status"), timeoutMs); }
  catch (error) {
    const absent = error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ECONNREFUSED");
    return { daemon: { running: absent ? false : null }, hub: { connected: null }, health: { state: "unavailable", issues: ["Daemon status is unavailable. Run kom doctor; after configuration, start kom daemon run."] } };
  }
  finally { client.close(); }
}
