import { RELEASE_VERSION } from "@kommutator/protocol";
import WebSocket from "ws";
import * as z from "zod";
import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "@kommutator/protocol";
import type { DaemonConfig } from "./config.js";
import { OfflineError, RpcError } from "./errors.js";

export interface HubTransport {
  readonly connected: boolean;
  request(method: string, params: unknown): Promise<unknown>;
  start(onConnect: () => Promise<void>, onNotification: (method: string, params: unknown) => void): void;
  close(): Promise<void>;
}

const Envelope = z.object({
  jsonrpc: z.literal("2.0"), id: z.number().optional(), method: z.string().optional(), params: z.unknown().optional(),
  result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional(),
});

/** Single authenticated WS; every open performs hello before exposing readiness. */
export class HubLink implements HubTransport {
  connected = false;
  private ws: WebSocket | undefined;
  private stopped = false;
  private nextId = 0;
  private backoff = 100;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly config: DaemonConfig, private readonly onError: (message: string) => void = () => {}, private readonly timeoutMs = 5_000) {}

  start(onConnect: () => Promise<void>, onNotification: (method: string, params: unknown) => void): void {
    const connect = () => {
      if (this.stopped) return;
      const url = new URL(this.config.hub);
      url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
      const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.config.key}` }, maxPayload: MAX_FRAME_BYTES, handshakeTimeout: this.timeoutMs });
      this.ws = ws;
      ws.on("error", () => this.onError("hub WebSocket connection failed"));
      ws.on("message", (data) => {
        let parsed: z.infer<typeof Envelope>;
        try { parsed = Envelope.parse(JSON.parse(data.toString())); }
        catch { this.onError("invalid hub frame"); ws.terminate(); return; }
        if (parsed.id !== undefined) {
          const waiter = this.pending.get(parsed.id);
          if (!waiter) return;
          clearTimeout(waiter.timer);
          this.pending.delete(parsed.id);
          if (parsed.error) waiter.reject(new RpcError(parsed.error.code, parsed.error.message));
          else waiter.resolve(parsed.result);
        } else if (parsed.method) {
          try { onNotification(parsed.method, parsed.params); }
          catch { this.onError("invalid hub notification"); }
        }
      });
      ws.once("open", () => {
        void (async () => {
          try {
            const response = await this.rawRequest("hello", { host: this.config.host, agentd_version: RELEASE_VERSION, protocol_version: PROTOCOL_VERSION });
            const version = z.object({ protocol_version: z.number() }).parse(response).protocol_version;
            if (version !== PROTOCOL_VERSION) this.onError("hub protocol version differs from daemon");
            this.connected = true;
            this.backoff = 100;
            this.heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 20_000);
            await onConnect();
          } catch { this.onError("hub synchronization failed"); ws.terminate(); }
        })();
      });
      ws.once("close", () => {
        this.connected = false;
        if (this.heartbeat) clearInterval(this.heartbeat);
        for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new OfflineError()); }
        this.pending.clear();
        if (!this.stopped) {
          this.reconnect = setTimeout(connect, this.backoff);
          this.backoff = Math.min(10_000, this.backoff * 2);
        }
      });
    };
    connect();
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.connected) return Promise.reject(new OfflineError());
    return this.rawRequest(method, params);
  }

  private rawRequest(method: string, params: unknown): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new OfflineError());
    const id = ++this.nextId;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) return Promise.reject(new RpcError(-32011, "request exceeds frame limit"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OfflineError("hub request timed out"));
        ws.terminate();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(frame, (error) => { if (error) ws.terminate(); });
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new OfflineError()); }
    this.pending.clear();
    this.ws?.terminate();
  }
}
