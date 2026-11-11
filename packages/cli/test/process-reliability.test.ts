import { expectHookProcessTime } from "./hook-timing.js";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readHookObservations } from "../src/hook-observations.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

it.each([false, true])("keeps real hook output and observations truthful when IPC stalls=%s", async stalled => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-ipc-"));
  const sockets = new Set<Socket>();
  const methods: string[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        methods.push(request.method);
        if (stalled) continue;
        const result = request.method === "hook.poll" ? { block: true, headers: [{
          id: "notice", seq: 1, from: "peer@host", kind: "dm", priority: "normal", preview: "Visible notice",
          thread_id: "thread", created_at: "2026-11-04T00:00:00.000Z", state: "unread", wake: true,
        }] } : { bound: true };
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
          ...(request.method === "hook.ack" ? { error: { code: -32030, message: "secret transport details" } } : { result }),
        }) + "\n");
      }
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(join(home, "agentd.sock"), resolve));
    const env = { ...process.env, KOM_HOME: home };
    delete env.KOM_PLUGIN_PROFILE;
    const started = performance.now();
    const child = spawn(process.execPath, [entry, "hook", "Stop", "--vendor", "codex"], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.end(JSON.stringify({ session_id: "test-root" }));
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    const elapsedMs = performance.now() - started;
    expectHookProcessTime(elapsedMs, `Codex Stop IPC stalled=${stalled}`);
    expect(code).toBe(0);
    expect(stderr).not.toContain("secret transport details");
    const observations = await readHookObservations("test-root", home);
    if (stalled) {
      expect(stdout).toBe("");
      expect(observations.some(row => row.outcome === "success")).toBe(false);
      expect(methods).toEqual(["ipc.hello"]);
    } else {
      expect(JSON.parse(stdout).reason).toContain("Visible notice");
      expect(methods).toEqual(["ipc.hello", "hook.poll", "hook.ack"]);
      expect(observations).toMatchObject([{ outcome: "output-written-ack-unverified" }]);
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});

it("keeps built watch silent and does not start a missing daemon", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-watch-no-daemon-"));
  const child = spawn(process.execPath, [entry, "watch", "--session", "existing-id", "--topic", "kommutator-feedback"], {
    env: { ...process.env, KOM_HOME: home },
  });
  let stdout = "", stderr = "";
  const closed = new Promise<number | null>(resolve => child.once("close", resolve));
  child.stdout.on("data", chunk => { stdout += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("watch did not report unavailable daemon")), 3000);
      child.stderr.on("data", chunk => {
        stderr += String(chunk);
        if (stderr.includes("unavailable")) { clearTimeout(timeout); resolve(); }
      });
      child.once("error", reject);
    });
    child.kill("SIGTERM");
    expect(await closed).toBe(0);
    expect(stdout).toBe("");
    expect(stderr.match(/unavailable/g)).toHaveLength(1);
    expect(await readdir(home)).toEqual([]);
  } finally {
    child.kill("SIGKILL");
    await closed;
    await rm(home, { recursive: true, force: true });
  }
});
