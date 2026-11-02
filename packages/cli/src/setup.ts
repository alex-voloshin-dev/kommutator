import { pluginDaemonDiagnostics } from "./plugin-daemon.js";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { loadConfig, pathsFor, Config } from "@kommutator/agentd";
import { PROTOCOL_VERSION, toIdent } from "@kommutator/protocol";
import { hostname } from "node:os";
import { access, mkdir, writeFile, link, unlink } from "node:fs/promises";

/** Configuration and secrets stay in the user's browser, never in tool arguments. */
export class PrivateSetup {
  private server: Server | undefined;
  private url: string | undefined;
  private starting: Promise<{ configured: boolean; url?: string }> | undefined;
  private timer: NodeJS.Timeout | undefined;
  async status() {
    try { await loadConfig(); return { configured: true, ...await pluginDaemonDiagnostics() }; } catch { return { configured: false }; }
  }
  close(): void { clearTimeout(this.timer); this.server?.closeAllConnections(); this.server?.close(); this.server = undefined; this.url = undefined; }
  async start(): Promise<{ configured: boolean; url?: string }> {
    if (this.starting) return this.starting;
    this.starting = this.open();
    try { return await this.starting; } finally { this.starting = undefined; }
  }
  private async open(): Promise<{ configured: boolean; url?: string }> {
    if ((await this.status()).configured) return { configured: true };
    // Never overwrite malformed or legacy configuration through the onboarding form.
    try { await access(pathsFor().config); throw new Error("Existing configuration needs local repair; setup will not overwrite it"); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    if (this.url) return { configured: false, url: this.url };
    const token = randomBytes(32).toString("hex");
    let origin = "";
    let saving = false;
    const server = createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "same-origin");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
      const fail = (status: number, text: string) => { response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); response.end(text); };
      if (request.headers.host !== origin.slice(7) || request.url !== `/${token}`) { fail(403, "Forbidden"); return; }
      if (request.method === "GET") {
        if (request.headers.origin && request.headers.origin !== origin) { fail(403, "Forbidden"); return; }
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect kommutator</title><h1>Connect kommutator</h1><p>The hub key stays in this browser form and private local configuration. It is never sent to your agent.</p><form method="post"><input type="hidden" name="csrf" value="${token}"><p><label>Hub URL <input name="hub" type="url" value="http://127.0.0.1:8787" required maxlength="2048"></label></p><p><label>Host name <input name="host" value="${toIdent(hostname())}" required maxlength="63" pattern="[a-z0-9](?:[a-z0-9_]|-)*"></label></p><p><label>Hub key <input name="key" type="password" autocomplete="off" required minlength="16" maxlength="4096"></label></p><button>Connect</button></form></html>`);
        return;
      }
      if (request.method !== "POST" || request.headers.origin !== origin || request.headers["content-type"] !== "application/x-www-form-urlencoded") { fail(403, "Forbidden"); return; }
      if (saving) { fail(409, "Setup is already in progress"); return; }
      saving = true;
      try {
        let body = "";
        for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > 8192) throw new Error("body"); }
        const fields = new URLSearchParams(body);
        if (fields.get("csrf") !== token) { fail(403, "Forbidden"); return; }
        const parsed = Config.safeParse({ hub: fields.get("hub"), key: fields.get("key"), host: fields.get("host") });
        if (!parsed.success || parsed.data.hub.length > 2048 || parsed.data.key.length > 4096) throw new Error("invalid");
        const config = parsed.data;
        const url = new URL(config.hub);
        if (url.username || url.password || url.search || url.hash) throw new Error("url");
        url.protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
        url.pathname = "/api/snapshot";
        const health = await fetch(url, { headers: { Authorization: `Bearer ${config.key}` }, redirect: "error", signal: AbortSignal.timeout(3000) });
        if (!health.ok || !health.body) { await health.body?.cancel(); throw new Error("auth"); }
        let snapshot = "";
        for await (const chunk of health.body) { snapshot += Buffer.from(chunk).toString("utf8"); if (Buffer.byteLength(snapshot) > 2_000_000) throw new Error("size"); }
        const value: unknown = JSON.parse(snapshot);
        if (!value || typeof value !== "object" || !("protocol_version" in value) || value.protocol_version !== PROTOCOL_VERSION || !("sessions" in value) || !Array.isArray(value.sessions)) throw new Error("protocol");
        // Refuse a concurrent configuration write and never restart an active daemon.
        try { await access(pathsFor().config); throw new Error("exists"); } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
        }
        const paths = pathsFor();
        await mkdir(paths.home, { recursive: true, mode: 0o700 });
        const temp = `${paths.config}.${randomBytes(16).toString("hex")}.tmp`;
        try {
          await writeFile(temp, JSON.stringify(config) + "\n", { mode: 0o600, flag: "wx" });
          await link(temp, paths.config); // Atomic create-only commit: another setup wins safely.
        } finally { await unlink(temp).catch(() => undefined); }
        fail(200, "Connected. Return to your agent and call whoami.");
        setImmediate(() => this.close());
      } catch { fail(400, "Connection failed. Check the hub URL, host name and key locally, then retry."); }
      finally { saving = false; }
    });
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.setTimeout(5000, (socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("Cannot start local setup"); }
    origin = `http://127.0.0.1:${address.port}`;
    this.server = server;
    this.url = `${origin}/${token}`;
    this.timer = setTimeout(() => this.close(), 5 * 60_000);
    this.timer.unref();
    return { configured: false, url: this.url };
  }
}
