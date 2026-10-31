import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { MAX_FRAME_BYTES, Methods, PROTOCOL_VERSION } from "@kommutator/protocol";
import { pathsFor } from "@kommutator/agentd";
import * as z from "zod";
import { isCodexClient } from "./codex.js";

export type Hello = z.input<typeof Methods["ipc.hello"]>;
export interface RpcClient {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

export class IpcError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

const Reply = z.object({ jsonrpc: z.literal("2.0"), id: z.number().int(),
  result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() })
  .refine((reply) => Object.hasOwn(reply, "result") !== Object.hasOwn(reply, "error"), "Expected exactly one result or error");

/** Spawn the current installed entrypoint, not a possibly different `kom` on PATH. */
export function spawnDaemon(): void {
  const entry = process.argv[1];
  if (!entry) throw new Error("Cannot locate the kom entrypoint");
  const child = spawn(process.execPath, [entry, "daemon", "run"], {
    detached: true, stdio: "ignore", env: process.env,
  });
  child.on("error", () => { /* The next connection attempt reports startup failure. */ });
  child.unref();
}

export function shimHello(clientInfo?: { name: string; version?: string }): Hello {
  const codex = isCodexClient(clientInfo);
  const claude = !codex && /claude/i.test(clientInfo?.name ?? "");
  const vendorId = claude ? process.env.CLAUDE_CODE_SESSION_ID : undefined;
  return Methods["ipc.hello"].parse({
    client: "shim", protocol_version: PROTOCOL_VERSION, pid: process.pid, ppid: process.ppid,
    cwd: process.cwd(), vendor: codex ? "codex" : claude ? "claude-code" : "other",
    ...(vendorId ? { vendor_session_id: vendorId } : {}),
    ...(process.env.KOM_PROJECT ? { project_key: process.env.KOM_PROJECT } : {}),
    ...(clientInfo ? { client_info: clientInfo } : {}),
    ...(!codex && process.env.KOM_CLAUDE_INBOUND_POLICY ? { inbound_policy: process.env.KOM_CLAUDE_INBOUND_POLICY } : {}),
  });
}

export function cliHello(): Hello {
  return Methods["ipc.hello"].parse({ client: "cli", protocol_version: PROTOCOL_VERSION, pid: process.pid, ppid: process.ppid, cwd: process.cwd(),
    ...(process.env.KOM_PROJECT ? { project_key: process.env.KOM_PROJECT } : {}),
  });
}

interface Options {
  hello: () => Hello;
  endpoint?: string;
  timeoutMs?: number;
  lazyStart?: boolean;
  retries?: number;
  spawn?: () => void;
}

/** Reconnect between calls, but never replay a call whose reply was lost. The daemon owns replay. */
export class IpcClient implements RpcClient {
  private socket: Socket | undefined;
  private connecting: Promise<void> | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private buffer = "";
  private closed = false;
  constructor(private readonly options: Options) {}

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureConnected();
    return this.request(method, params);
  }

  close(): void {
    this.closed = true;
    this.disconnect(new IpcError("IPC client closed"));
  }

  private disconnect(error: Error): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
    this.buffer = "";
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new IpcError("IPC client closed");
    if (this.connecting) return this.connecting;
    if (this.socket && !this.socket.destroyed) return;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }

  private async open(): Promise<void> {
    const retries = this.options.retries ?? 6;
    for (let attempt = 0; ; attempt++) {
      if (this.closed) throw new IpcError("IPC client closed");
      try {
        await this.openSocket();
        await this.request("ipc.hello", this.options.hello());
        return;
      } catch (error) {
        this.disconnect(error instanceof Error ? error : new IpcError("IPC connection failed"));
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
        if (!this.options.lazyStart) throw error;
        if (attempt === 0) (this.options.spawn ?? spawnDaemon)();
        if (attempt >= retries || this.closed) throw new IpcError("Daemon unavailable; check kom init and kom daemon run");
        await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)));
      }
    }
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.options.endpoint ?? pathsFor().ipc);
      this.socket = socket;
      socket.setEncoding("utf8");
      const timer = setTimeout(() => { socket.destroy(); reject(new IpcError("IPC connection timed out")); }, this.options.timeoutMs ?? 5_000);
      socket.once("connect", () => { clearTimeout(timer); resolve(); });
      socket.on("error", (error) => { clearTimeout(timer); reject(error); if (this.socket === socket) this.disconnect(error); });
      socket.on("close", () => { clearTimeout(timer); if (this.socket === socket) this.disconnect(new IpcError("Daemon disconnected; delivery state may be uncertain; do not resend blindly")); });
      socket.on("data", (chunk: string) => {
        if (this.socket !== socket) return;
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES && !this.buffer.includes("\n")) {
          this.disconnect(new IpcError("Oversized IPC frame")); return;
        }
        let end: number;
        while ((end = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          try {
            if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error("Oversized IPC frame");
            const reply = Reply.parse(JSON.parse(line) as unknown);
            const waiter = this.pending.get(reply.id);
            if (!waiter) continue;
            clearTimeout(waiter.timer); this.pending.delete(reply.id);
            if (reply.error) waiter.reject(new IpcError(reply.error.message, reply.error.code));
            else waiter.resolve(reply.result);
          } catch { this.disconnect(new IpcError("Malformed IPC response")); return; }
        }
      });
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new IpcError("Daemon unavailable"));
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) return Promise.reject(new IpcError("Oversized IPC request"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new IpcError("Daemon request timed out; delivery state may be uncertain; do not resend blindly"));
      }, this.options.timeoutMs ?? 5_000);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(frame, (error) => { if (error) this.disconnect(error); });
    });
  }
}
