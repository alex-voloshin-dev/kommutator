import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as z from "zod";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const Request = z.object({ id: z.number(), method: z.string(), params: z.unknown().optional() });

it("delivers and acknowledges a hook header without loading daemon-only dependencies", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-import-"));
  const denied = join(home, "denied-imports");
  const preload = join(home, "deny-daemon-imports.mjs");
  await writeFile(denied, "");
  await writeFile(preload, `
    import { appendFileSync } from 'node:fs';
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'ws' || specifier === 'node:sqlite') {
        appendFileSync(process.env.KOM_DENIED_IMPORTS, specifier + '\\n');
        throw new Error('Daemon-only dependency reached the hook');
      }
      return nextResolve(specifier, context);
    } });
  `);
  const sockets = new Set<Socket>();
  const socketErrors: string[] = [];
  const requests: z.infer<typeof Request>[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (socketErrors.length < 4) socketErrors.push(error.code?.slice(0, 40) ?? "UNKNOWN");
    });
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = Request.parse(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
        requests.push(request);
        const result = request.method === "hook.poll" ? { block: true, headers: [{
          id: "visible-notice", seq: 1, from: "peer@fixture", kind: "dm", priority: "normal",
          preview: "Visible fixture notice", thread_id: "fixture-thread",
          created_at: "2026-11-12T00:00:00.000Z", state: "unread", wake: true,
        }] } : { bound: true };
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(home, "agentd.sock"), () => { server.off("error", reject); resolve(); });
    });
    const child = spawn(process.execPath, ["--import", preload, entry, "hook", "Stop", "--vendor", "codex"], {
      env: { PATH: process.env.PATH ?? "", KOM_HOME: home, KOM_DENIED_IMPORTS: denied },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Hook process did not exit")); }, 3_000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("close", value => { clearTimeout(timeout); resolve(value); });
      child.stdin.end(JSON.stringify({ session_id: "fixture-root" }));
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    // Fail-open exit alone would also pass if the resolver rejected a daemon import.
    const deniedImports = await readFile(denied, "utf8");
    expect(stdout, `Denied hook imports: ${deniedImports}`).toContain("Visible fixture notice");
    expect(JSON.parse(stdout)).toMatchObject({ decision: "block" });
    expect(requests.map(request => request.method)).toEqual(["ipc.hello", "hook.poll", "hook.ack"]);
    expect(requests[2]?.params).toEqual({ ids: ["visible-notice"] });
    expect(deniedImports).toBe("");
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
  expect(socketErrors).toEqual([]);
});
