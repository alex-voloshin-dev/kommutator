import { createServer, connect, type Server, type Socket } from "node:net";
import { chmod, lstat, open, readFile, unlink } from "node:fs/promises";
import * as z from "zod";
import { MAX_FRAME_BYTES } from "@kommutator/protocol";
import { OfflineError, RpcError } from "./errors.js";
import type { IpcPeer } from "./core.js";

const Request = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.number().int(), z.string().max(100)]).nullable().optional(), method: z.string(), params: z.unknown().optional() });
type Response = { jsonrpc: "2.0"; id: number | string | null; result?: unknown; error?: { code: number; message: string } };
export class AlreadyRunningError extends Error { constructor() { super("agentd is already running"); } }

function probe(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const timer = setTimeout(() => { socket.destroy(); resolve(true); }, 250);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", () => { clearTimeout(timer); resolve(false); });
  });
}
function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error) => { server.off("listening", ready); reject(error); };
    const ready = () => { server.off("error", failed); resolve(); };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(path);
  });
}

/** Serialize only stale-path reclamation; a live socket remains the instance lock. */
async function recoveryLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.recovery`;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const file = await open(lockPath, "wx", 0o600);
      await file.writeFile(String(process.pid));
      await file.close();
      return async () => { await unlink(lockPath); };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        const pid = Number(await readFile(lockPath, "utf8"));
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); }
          catch (aliveError) {
            if (aliveError instanceof Error && "code" in aliveError && aliveError.code === "ESRCH") {
              try { await unlink(lockPath); } catch { /* Another contender reclaimed the dead lock. */ }
              continue;
            }
          }
        }
      } catch { /* A contender may release the lock between the failed open and read. */ }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new AlreadyRunningError();
}

export async function startIpc(options: {
  path: string;
  peer(): IpcPeer;
  disconnect(peer: IpcPeer): void;
  request(peer: IpcPeer, method: string, params: unknown): Promise<unknown>;
}) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let peer: IpcPeer;
    try { peer = options.peer(); } catch { sockets.delete(socket); socket.destroy(); return; }
    let buffer = Buffer.alloc(0);
    let queue = Promise.resolve();
    socket.on("error", () => { socket.destroy(); });
    socket.once("close", () => { sockets.delete(socket); options.disconnect(peer); });
    const reply = (value: Response) => {
      if (socket.destroyed) return;
      if (socket.writableLength > MAX_FRAME_BYTES) { socket.destroy(); return; }
      let frame = JSON.stringify(value);
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
        frame = JSON.stringify({ jsonrpc: "2.0", id: value.id, error: {
          code: -32011, message: "result exceeds frame limit; narrow query or reduce page size",
        } });
      }
      socket.write(frame + "\n");
    };
    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) break;
        if (newline > MAX_FRAME_BYTES) { socket.destroy(); return; }
        const line = buffer.subarray(0, newline).toString("utf8");
        buffer = buffer.subarray(newline + 1);
        queue = queue.then(async () => {
          if (socket.destroyed) return;
          let decoded: unknown;
          try { decoded = JSON.parse(line); }
          catch { reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
          const envelope = Request.safeParse(decoded);
          if (!envelope.success) { reply({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid JSON-RPC frame" } }); return; }
          const parsed = envelope.data;
          const id = parsed.id;
          const notification = id === undefined || id === null;
          try {
            const result = await options.request(peer, parsed.method, parsed.params ?? {});
            if (!notification) reply({ jsonrpc: "2.0", id, result });
          } catch (error) {
            if (!notification) reply({ jsonrpc: "2.0", id, error: {
              code: error instanceof RpcError ? error.code : error instanceof OfflineError ? -32030 : error instanceof z.ZodError ? -32602 : -32000,
              message: error instanceof RpcError ? error.message : error instanceof OfflineError ? "Hub unavailable or request timed out; inspect status before retrying a mutation." : error instanceof z.ZodError ? "invalid method parameters" : "daemon request failed",
            } });
          }
        });
      }
      if (buffer.length > MAX_FRAME_BYTES) socket.destroy();
    });
  });
  try { await listen(server, options.path); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EADDRINUSE") throw error;
    if (await probe(options.path)) throw new AlreadyRunningError();
    const unlock = await recoveryLock(options.path);
    try {
      if (await probe(options.path)) throw new AlreadyRunningError();
      try {
        const entry = await lstat(options.path);
        if (!entry.isSocket()) throw new Error("refusing to replace non-socket IPC path");
        await unlink(options.path);
      } catch (stale) { if (!(stale instanceof Error && "code" in stale && stale.code === "ENOENT")) throw stale; }
      try { await listen(server, options.path); }
      catch (retry) { if (await probe(options.path)) throw new AlreadyRunningError(); throw retry; }
    } finally { await unlock(); }
  }
  await chmod(options.path, 0o600);
  server.on("error", () => { for (const socket of sockets) socket.destroy(); });
  return {
    server,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      try { await unlink(options.path); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    },
  };
}
