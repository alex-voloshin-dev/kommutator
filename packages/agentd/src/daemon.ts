import { RELEASE_VERSION } from "@kommutator/protocol";
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { Config, loadConfig, type DaemonConfig } from "./config.js";
import { DaemonCore, type CoreOptions } from "./core.js";
import { HubLink, type HubTransport } from "./hub-link.js";
import { AlreadyRunningError, startIpc } from "./ipc.js";
import { pathsFor } from "./paths.js";

export interface DaemonOptions extends Omit<CoreOptions, "config" | "dbPath" | "transport" | "onShutdown"> {
  home?: string;
  config?: DaemonConfig;
  transport?: HubTransport;
  idleMs?: number;
  sweepMs?: number;
}

export async function startDaemon(options: DaemonOptions = {}) {
  const paths = pathsFor(options.home);
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700);
  const config = Config.parse(options.config ?? await loadConfig(paths.home));
  if (existsSync(paths.config)) await chmod(paths.config, 0o600);
  const log = (message: string) => {
    // Only fixed diagnostic strings reach this sink; params contain vendor tokens and keys.
    if (existsSync(paths.log) && statSync(paths.log).size > 1_048_576) renameSync(paths.log, `${paths.log}.1`);
    appendFileSync(paths.log, JSON.stringify({ at: new Date().toISOString(), message }) + "\n", { mode: 0o600 });
    options.onError?.(message);
  };
  let core: DaemonCore | undefined;
  const ipc = await startIpc({
    path: paths.ipc,
    peer: () => { if (!core) throw new Error("daemon is starting"); return core.peer(); },
    disconnect: (peer) => core?.disconnect(peer),
    request: (peer, method, params) => { if (!core) throw new Error("daemon is starting"); return core.request(peer, method, params); },
  });
  let stopped = false;
  let idleSince = Date.now();
  let sweep: ReturnType<typeof setInterval> | undefined;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const close = async () => {
    if (stopped) return closed;
    stopped = true;
    if (sweep) clearInterval(sweep);
    await core?.close();
    await ipc.close();
    try { await unlink(paths.daemonInfo); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    resolveClosed();
  };
  try {
    const transport = options.transport ?? new HubLink(config, (message) => { if (core) core.report(message); else log(message); });
    core = new DaemonCore({ ...options, config, dbPath: paths.stateDb, transport, onError: log, onShutdown: () => { setTimeout(() => { void close().catch(() => log("daemon shutdown failed")); }, 10); } });
    await chmod(paths.stateDb, 0o600);
    await core.start();
    await writeFile(paths.daemonInfo, JSON.stringify({ pid: process.pid, version: RELEASE_VERSION, started_at: new Date().toISOString(), endpoint: paths.ipc }) + "\n", { mode: 0o600 });
    let sweeping = false;
    sweep = setInterval(() => {
      if (sweeping || !core || stopped) return;
      sweeping = true;
      void core.sweep().then(async () => {
        if (!core) return;
        if (core.registry.all().some((record) => record.session.state !== "gone")) idleSince = Date.now();
        else if (Date.now() - idleSince > (options.idleMs ?? 30 * 60_000)) await close();
      }).catch(() => log("daemon liveness sweep failed")).finally(() => { sweeping = false; });
    }, options.sweepMs ?? 20_000);
    return { core, paths, close, closed };
  } catch (error) { await ipc.close(); await core?.close(); throw error; }
}

export async function runDaemon(options: DaemonOptions = {}): Promise<void> {
  let daemon: Awaited<ReturnType<typeof startDaemon>>;
  try { daemon = await startDaemon(options); }
  catch (error) { if (error instanceof AlreadyRunningError) return; throw error; }
  const stop = () => { void daemon.close(); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await daemon.closed;
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
}
