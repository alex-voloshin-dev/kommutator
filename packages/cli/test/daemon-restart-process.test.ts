import { createServer, type Socket } from "node:net";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

it("restarts after a reset during shutdown, only after the old listener closes", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-restart-reset-"));
  const endpoint = join(home, "agentd.sock");
  const sockets = new Set<Socket>();
  let shutdowns = 0;
  let daemonPid: number | undefined;
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (frame.method === "daemon.shutdown") {
          shutdowns++;
          server.close(); socket.destroy();
        } else socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }) + "\n");
      }
    });
  });
  const preload = join(home, "reset-on-close.mjs");
  // Unix close commonly surfaces EOF; inject the observed ECONNRESET at this real close
  // boundary so the regression is deterministic across supported Unix platforms.
  await writeFile(preload, `
    import net from 'node:net';
    import childProcess from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    const spawn = childProcess.spawn;
    childProcess.spawn = (...args) => {
      if (args[1]?.includes('daemon') && args[1]?.includes('run')) appendFileSync(process.env.KOM_HOME + '/spawns', 'spawn\\n');
      return spawn(...args);
    };
    import { syncBuiltinESMExports } from 'node:module';
    const connect = net.connect; let first = true;
    net.connect = (...args) => {
      const socket = connect(...args);
      if (first) { first = false; socket.prependOnceListener('close', () => {
        socket.emit('error', Object.assign(new Error('synthetic shutdown reset'), { code: 'ECONNRESET' }));
      }); }
      return socket;
    };
    syncBuiltinESMExports();
  `);
  await writeFile(join(home, "config.json"), JSON.stringify({ hub: "http://127.0.0.1:1", host: "restart-fixture", key: "x".repeat(32) }), { mode: 0o600 });
  await new Promise<void>(resolve => server.listen(endpoint, resolve));
  const env = { ...process.env, KOM_HOME: home, NODE_ENV: "production" };
  try {
    const { stdout } = await execute(process.execPath, ["--import", preload, entry, "daemon", "restart"], { env, timeout: 10_000 });
    const status = JSON.parse(stdout);
    expect(status.daemon.running).toBe(true);
    daemonPid = status.daemon.pid;
    expect(shutdowns).toBe(1);
    expect(await readFile(join(home, "spawns"), "utf8")).toBe("spawn\n");
    expect(server.listening).toBe(false);
    const info = JSON.parse(await readFile(join(home, "agentd.json"), "utf8"));
    expect(info.pid).toBe(status.daemon.pid);
    expect(info.pid).not.toBe(process.pid);
    // The replacement remains addressable; a second management query must not spawn.
    const again = await execute(process.execPath, [entry, "status"], { env, timeout: 5_000 });
    expect(JSON.parse(again.stdout).daemon.pid).toBe(info.pid);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await execute(process.execPath, [entry, "daemon", "stop"], { env, timeout: 5_000 }).catch(() => undefined);
    if (daemonPid !== undefined) {
      try { process.kill(daemonPid, "SIGTERM"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    }
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 15_000);

it.each(["hello", "shutdown", "confirmation"])("bounds a stalled %s phase without spawning a replacement", async phase => {
  const home = await mkdtemp(join(tmpdir(), "kom-stop-stall-"));
  const sockets = new Set<Socket>();
  let shutdowns = 0;
  const server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (frame.method === "daemon.shutdown") shutdowns++;
        if ((phase === "hello" && frame.method === "ipc.hello") ||
            (phase === "shutdown" && frame.method === "daemon.shutdown") ||
            (phase === "confirmation" && frame.method === "daemon.status")) continue;
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }) + "\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(join(home, "agentd.sock"), resolve));
  try {
    const started = performance.now();
    const error = await execute(process.execPath, [entry, "daemon", "restart"], {
      env: { ...process.env, KOM_HOME: home, NODE_ENV: "production" }, timeout: 5_000,
    }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 1, stderr: expect.stringContaining(phase === "confirmation" ? "stop confirmation failed" : "shutdown request failed") });
    expect(performance.now() - started).toBeLessThan(3_500);
    expect(server.listening).toBe(true);
    expect(shutdowns).toBe(phase === "hello" ? 0 : 1);
    await expect(readFile(join(home, "agentd.json"))).rejects.toMatchObject({ code: "ENOENT" });
    // Deadline cancellation closes the pending management connection, not only its waiter.
    await expect.poll(() => sockets.size).toBe(0);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}, 8_000);
