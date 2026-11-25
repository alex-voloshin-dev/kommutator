import { createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { runHook } from "../src/hooks.js";
import { readHookObservations } from "../src/hook-observations.js";

afterEach(() => { vi.unstubAllEnvs(); });

it.each([
  { mode: "reject-hello", reason: "registration-rejected", phase: "ipc-hello", methods: ["ipc.hello"] },
  { mode: "stall-hello", reason: "ipc-timeout", phase: "ipc-hello", methods: ["ipc.hello"] },
  { mode: "stall-whoami", reason: "ipc-timeout", phase: "whoami", methods: ["ipc.hello", "whoami"] },
])("distinguishes $mode without replay or remote text disclosure", async ({ mode, reason, phase, methods }) => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-detail-"));
  vi.stubEnv("KOM_HOME", home);
  vi.stubEnv("KOM_PLUGIN_PROFILE", "");
  const sockets = new Set<Socket>();
  const seen: string[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    let buffer = "";
    socket.on("data", chunk => {
      buffer += String(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end)) as { id: number; method: string };
        buffer = buffer.slice(end + 1);
        seen.push(request.method);
        if (mode === "reject-hello") socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
          error: { code: -32020, message: "SECRET remote token and /private/path" } }) + "\n");
        else if (mode === "stall-whoami" && request.method === "ipc.hello") {
          socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { bound: true } }) + "\n");
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(join(home, "agentd.sock"), resolve));
  try {
    await runHook("SessionStart", [], { payload: { session_id: "secret-root", cwd: home } });
    expect(seen).toEqual(methods);
    const observations = await readHookObservations("secret-root", home);
    expect(observations).toEqual([expect.objectContaining({ outcome: "failed", reason, phase })]);
    expect(JSON.stringify(observations)).not.toMatch(/SECRET|private\/path|secret-root/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
});
