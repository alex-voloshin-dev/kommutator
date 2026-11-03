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
        const retainedSessions = `SELECT * FROM sessions WHERE ended_at IS NULL
          UNION ALL SELECT * FROM (
            SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC, id DESC LIMIT 100
          ) ORDER BY handle, id`;
        const sessions = db.prepare(retainedSessions).all();
        const hosts = db.prepare("SELECT * FROM hosts ORDER BY name").all();
        // Counts include historical members; displayed identities follow the same retention
        // window as sessions. Resolve all memberships in one query, not one per topic.
        const members = new Map<number, string[]>();
        for (const row of db.prepare(`WITH retained AS (${retainedSessions})
          SELECT m.topic_id, m.session_id FROM memberships m JOIN retained s ON s.id = m.session_id
          ORDER BY m.topic_id, m.session_id`).all()) {
          if (typeof row.session_id !== "string" || typeof row.topic_id !== "number") continue;
          const list = members.get(row.topic_id) ?? [];
          list.push(row.session_id);
          members.set(row.topic_id, list);
        }
        const topics = db.prepare(`SELECT t.id, t.name, t.kind, t.project_key,
          COUNT(s.id) AS total_members,
          COALESCE(SUM(CASE WHEN s.id IS NOT NULL AND s.ended_at IS NULL THEN 1 ELSE 0 END), 0) AS current_members
          FROM topics t LEFT JOIN memberships m ON m.topic_id = t.id
          LEFT JOIN sessions s ON s.id = m.session_id
          GROUP BY t.id ORDER BY t.name`).all().map(topic => {
          const ids = members.get(Number(topic.id)) ?? [];
          return { ...topic, members: ids, hidden_ended_members: Number(topic.total_members) - ids.length };
        });
        const deliveries = db.prepare(`SELECT d.message_id AS id, d.session_id, d.seq, d.state, d.wake, d.updated_at,
          s.handle AS recipient, COALESCE(NULLIF(m.from_handle, ''), a.handle) AS sender, m.kind, m.priority, m.subject, m.body
          FROM deliveries d JOIN sessions s ON s.id = d.session_id
          JOIN messages m ON m.id = d.message_id JOIN sessions a ON a.id = m.from_session
          ORDER BY d.updated_at DESC, d.session_id, d.seq DESC LIMIT 200`).all()
          .map(({ body, ...delivery }) => ({ ...delivery, preview: makePreview(typeof body === "string" ? body : "") }));
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ protocol_version: PROTOCOL_VERSION, hosts, sessions, topics, deliveries }));
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
