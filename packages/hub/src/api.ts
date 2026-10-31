import type { IncomingMessage, ServerResponse } from "node:http";
import { makePreview, MAX_FRAME_BYTES, PROTOCOL_VERSION } from "@kommutator/protocol";
import type { HubRuntime } from "./rpc.js";

/** Called only after the HTTP authorization check. Live SSE is intentionally not a replay log. */
export function createApi(runtime: HubRuntime) {
  const streams = new Set<ServerResponse>();

  return {
    handle(req: IncomingMessage, res: ServerResponse): boolean {
      if (req.url === "/api/snapshot") {
        const db = runtime.context.db;
        // Keep every live session visible without turning the dashboard into an unbounded archive.
        const sessions = db.prepare(`SELECT * FROM sessions WHERE ended_at IS NULL
          UNION ALL SELECT * FROM (
            SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC, id DESC LIMIT 100
          ) ORDER BY handle, id`).all();
        const hosts = db.prepare("SELECT * FROM hosts ORDER BY name").all();
        const deliveries = db.prepare(`SELECT d.message_id AS id, d.session_id, d.seq, d.state, d.wake, d.updated_at,
          s.handle AS recipient, COALESCE(NULLIF(m.from_handle, ''), a.handle) AS sender, m.kind, m.priority, m.subject, m.body
          FROM deliveries d JOIN sessions s ON s.id = d.session_id
          JOIN messages m ON m.id = d.message_id JOIN sessions a ON a.id = m.from_session
          ORDER BY d.updated_at DESC, d.session_id, d.seq DESC LIMIT 200`).all()
          .map(({ body, ...delivery }) => ({ ...delivery, preview: makePreview(typeof body === "string" ? body : "") }));
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ protocol_version: PROTOCOL_VERSION, hosts, sessions, deliveries }));
        return true;
      }
      if (req.url !== "/api/events") return false;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      });
      streams.add(res);
      const write = (frame: string): void => {
        // write(false) signals normal stream backpressure, even for one valid large event.
        // Bound accumulated backlog independently; disconnected dashboards fetch a snapshot.
        if (res.writableLength + Buffer.byteLength(frame) > 2 * MAX_FRAME_BYTES) res.destroy();
        else if (!res.destroyed) res.write(frame);
      };
      write(": connected\n\n");
      const unsubscribe = runtime.events.subscribe((event) => {
        if (event.type === "deliver") return; // daemon transport, including reconnect replays
        const visible = event.type === "session.heartbeat" ? { ...event, type: "session.updated" } : event;
        write(`id: ${visible.id}\nevent: ${visible.type}\ndata: ${JSON.stringify(visible)}\n\n`);
      });
      const heartbeat = setInterval(() => write(": keepalive\n\n"), 20_000);
      heartbeat.unref();
      res.once("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(res);
      });
      return true;
    },
    close(): void { for (const stream of streams) stream.end(); },
  };
}
