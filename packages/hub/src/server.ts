// HTTP + WebSocket front of the hub. Every request — dashboard page, JSON API and the
// agentd WebSocket — must present KOM_KEY. WebSocket requires `Authorization: Bearer <key>`;
// HTTP also accepts Basic with any user name and the key as password (browser dashboard).
// There is no unauthenticated endpoint (DESIGN.md §12).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { DatabaseSync } from "node:sqlite";
import * as z from "zod";
import { Ident, MAX_FRAME_BYTES, Notifications } from "@kommutator/protocol";
import { createHubRuntime, rpcError, type HubRuntime } from "./rpc.js";
import { createApi } from "./api.js";
import type { HubPeer } from "./context.js";

export { dispatch } from "./rpc.js";

export interface HubOptions {
  db: DatabaseSync;
  key: string;
  /** Directory with the static dashboard; defaults to the package's public/. */
  publicDir?: string;
  /** Called with per-connection errors (oversize frame, invalid frame, reset). Default: console.warn. */
  onConnectionError?: (err: Error, ws: WebSocket) => void;
  runtime?: HubRuntime;
}

export function isAuthorized(header: string | undefined, key: string): boolean {
  if (!header || key.length === 0) return false;
  let presented: string | undefined;
  if (header.startsWith("Bearer ")) {
    presented = header.slice(7).trim();
  } else if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    presented = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  }
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

function deny(res: ServerResponse): void {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="kommutator"',
    "content-type": "text/plain",
  });
  res.end("unauthorized\n");
}

export function createHubServer(opts: HubOptions): Server {
  const publicDir = opts.publicDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  const indexHtml = readFileSync(join(publicDir, "index.html"));
  const onConnectionError = opts.onConnectionError ?? ((err) => console.warn("ws connection error:", err.message));
  const runtime = opts.runtime ?? createHubRuntime({ db: opts.db });
  if (runtime.context.db !== opts.db) throw new Error("hub runtime must use the server database");
  const api = createApi(runtime);
  const hosts = new Map<string, WebSocket>();

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (!isAuthorized(req.headers.authorization, opts.key)) return deny(res);
    try {
      if (req.method !== "GET") {
        res.writeHead(405, { allow: "GET" });
        res.end();
        return;
      }
      if (api.handle(req, res)) return;
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(indexHtml);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
    } catch {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error\n");
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  wss.on("error", (err) => console.warn("ws server error:", err.message));
  const DeliveryEvent = z.object({ host: Ident, notification: Notifications.deliver });
  const unsubscribe = runtime.events.subscribe((event) => {
    if (event.type !== "deliver") return;
    const { host, notification } = DeliveryEvent.parse(event.data);
    const ws = hosts.get(host);
    if (!ws || ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > MAX_FRAME_BYTES) { ws.terminate(); return; }
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "deliver", params: notification }), (error) => {
      if (error) { onConnectionError(error, ws); ws.terminate(); }
    });
  });

  http.on("upgrade", (req, socket, head) => {
    // Browsers can automatically attach cached Basic credentials cross-origin. A daemon
    // supplies Bearer explicitly; rejecting Basic prevents browser-originated RPC mutations.
    if (!req.headers.authorization?.startsWith("Bearer ") || !isAuthorized(req.headers.authorization, opts.key)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const peer: HubPeer = {};
      let registeredHost: string | undefined;
      ws.once("close", () => {
        if (peer.host && hosts.get(peer.host) === ws) hosts.delete(peer.host);
      });
      // A per-connection error (oversize frame, bad frame, reset) must only end this
      // connection. Without this handler `ws` emits an unhandled 'error' and the whole
      // process exits (R01 in docs/reviews/PROJECT_REVIEW_FOLLOWUP_2026-10-24.md).
      ws.on("error", (err) => {
        onConnectionError(err, ws);
        ws.terminate();
      });
      ws.on("message", (data) => {
        // An exception thrown inside this callback is NOT turned into a ws 'error' event;
        // it would propagate to the process. Contain it here, per connection.
        try {
          if (registeredHost && hosts.get(registeredHost) !== ws) { ws.terminate(); return; }
          const reply = runtime.dispatch(data.toString(), peer);
          if (peer.host && registeredHost === undefined) {
            registeredHost = peer.host;
            const previous = hosts.get(peer.host);
            hosts.set(peer.host, ws);
            previous?.close(1000, "host reconnected");
          }
          if (reply !== undefined) ws.send(reply);
        } catch (err) {
          onConnectionError(err instanceof Error ? err : new Error(String(err)), ws);
          try {
            ws.send(rpcError(null, -32603, "internal error"));
          } catch {
            /* connection already gone */
          }
        }
      });
    });
  });

  const close = http.close.bind(http);
  http.close = (callback) => {
    unsubscribe();
    api.close();
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    return close(callback);
  };

  return http;
}
