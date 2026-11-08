import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as z from "zod";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const Request = z.object({ jsonrpc: z.literal("2.0"), id: z.number(), method: z.string(), params: z.record(z.string(), z.unknown()) });
const boardEntry = { topic: "kommutator-feedback", key: "decisions", body: "First line\nUnicode: café ✓", version: 2,
  author: "author@host", protected: true, updated_at: "2026-11-08T00:00:00Z" };

async function withBoardServer(reply: Record<string, unknown>, run: (home: string, requests: z.infer<typeof Request>[]) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "kom-board-ipc-"));
  const sockets = new Set<Socket>();
  const requests: z.infer<typeof Request>[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = Request.parse(JSON.parse(buffer.slice(0, end)) as unknown);
        buffer = buffer.slice(end + 1);
        requests.push(request);
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: request.id,
          ...(request.method === "ipc.hello" ? { result: { bound: false } } : reply),
        }) + "\n");
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(home, "agentd.sock"), resolve);
    });
    await run(home, requests);
    expect(await readdir(home)).toEqual(["agentd.sock"]);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}

function environment(home: string) {
  return { ...process.env, KOM_HOME: home, NODE_ENV: "production", CONSOLA_LEVEL: "3",
    CLAUDE_CODE_SESSION_ID: "wrong-inherited-session", CODEX_THREAD_ID: "wrong-inherited-thread" };
}

it.each([
  { command: "get", key: "decisions", entries: [boardEntry] },
  { command: "list", key: undefined, entries: [boardEntry, { ...boardEntry, key: "handoff/author", body: "Second entry" }] },
  { command: "get", key: "missing", entries: [] },
])("built board $command returns exact JSON for key $key through IPC", async ({ command, key, entries }) => {
  await withBoardServer({ result: { entries } }, async (home, requests) => {
    const { stdout, stderr } = await execute(process.execPath, [entry, "board", command,
      "--session", "explicit-session", "--topic", boardEntry.topic, ...(key === undefined ? [] : ["--key", key])],
    { env: environment(home), timeout: 5000 });
    expect(JSON.parse(stdout)).toEqual({ entries });
    expect(stderr).toBe("");
    expect(requests.map(request => request.method)).toEqual(["ipc.hello", "board.get"]);
    expect(requests[0]?.params).toMatchObject({ client: "cli" });
    expect(requests[1]?.params).toEqual({ session_id: "explicit-session", topic: boardEntry.topic,
      ...(key === undefined ? {} : { key }) });
  });
});

it.each([
  { label: "membership denial", reply: { error: { code: -32003, message: "Not a topic member" } } },
  { label: "invalid board result", reply: { result: { entries: [{ ...boardEntry, version: -1 }] } } },
])("built board list fails without JSON on $label", async ({ reply }) => {
  await withBoardServer(reply, async (home, requests) => {
    await expect(execute(process.execPath, [entry, "board", "list", "--session", "explicit-session",
      "--topic", boardEntry.topic], { env: environment(home), timeout: 5000 }))
      .rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.any(String) });
    expect(requests.map(request => request.method)).toEqual(["ipc.hello", "board.get"]);
  });
});
