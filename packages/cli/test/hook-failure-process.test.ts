import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readHookObservations } from "../src/hook-observations.js";
import { expectHookProcessTime } from "./hook-timing.js";

it("keeps a compiled rejected hook fail-open while retaining only bounded failure evidence", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-failure-process-"));
  const sockets = new Set<Socket>();
  const methods: string[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => { socket.destroy(); });
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end)) as { id: number; method: string };
        buffer = buffer.slice(end + 1);
        methods.push(request.method);
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32020, message: "PRIVATE /secret/path credential" } }) + "\n");
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(join(home, "agentd.sock"), resolve); });
    const started = performance.now();
    const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url)), "hook", "UserPromptSubmit", "--vendor", "codex"], {
      env: { PATH: process.env.PATH ?? "", KOM_HOME: home }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("fixture hook did not exit")); }, 3_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.stdin.once("error", error => { clearTimeout(timer); child.kill("SIGKILL"); reject(error); });
      child.once("close", result => { clearTimeout(timer); resolve(result); });
      child.stdin.end(JSON.stringify({ session_id: "fixture-process-root", cwd: home }));
    });
    const elapsed = performance.now() - started;
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expectHookProcessTime(elapsed, "compiled registration rejection diagnostics");
    expect(methods).toEqual(["ipc.hello"]);
    const observations = await readHookObservations("fixture-process-root", home);
    expect(observations).toEqual([expect.objectContaining({ event: "UserPromptSubmit", outcome: "failed", reason: "registration-rejected", phase: "ipc-hello" })]);
    expect(JSON.stringify(observations)).not.toMatch(/PRIVATE|secret\/path|credential|fixture-process-root/);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
