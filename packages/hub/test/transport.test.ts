import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import WebSocket from "ws";
import { z } from "zod";
import { Notifications, Results } from "@kommutator/protocol";
import { createHubServer } from "../src/server.js";
import { openDatabase } from "../src/db.js";

const KEY = "local-test-0123456789abcdef";
const resources: Array<{ server: Server; db: ReturnType<typeof openDatabase>; clients: WebSocket[] }> = [];
afterEach(async () => {
  for (const { server, db, clients } of resources.splice(0)) {
    for (const client of clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

async function start() {
  const db = openDatabase(":memory:");
  const server = createHubServer({ db, key: KEY });
  const clients: WebSocket[] = [];
  resources.push({ server, db, clients });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing listen address");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base, db, server,
    async connect() {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`, { headers: { authorization: `Bearer ${KEY}` } });
      clients.push(ws);
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      let id = 0;
      const replies = new Map<number, (reply: unknown) => void>();
      const deliveries: Array<z.output<typeof Notifications.deliver>> = [];
      ws.on("message", (raw) => {
        const message = z.object({ id: z.number().optional(), method: z.string().optional(), params: z.unknown().optional() })
          .passthrough().parse(JSON.parse(raw.toString()));
        if (message.method === "deliver") deliveries.push(Notifications.deliver.parse(message.params));
        if (message.id !== undefined) { replies.get(message.id)?.(message); replies.delete(message.id); }
      });
      return {
        ws, deliveries,
        request(method: string, params: unknown = {}): Promise<unknown> {
          const requestId = ++id;
          return new Promise((resolve) => {
            replies.set(requestId, resolve);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }));
          });
        },
      };
    },
  };
}

function result(value: unknown): unknown { return z.object({ result: z.unknown() }).parse(value).result; }

describe("hub WebSocket and authenticated SSE integration", () => {
  it("keeps browser Basic auth for HTTP but rejects it for WebSocket upgrades from any origin", async () => {
    const hub = await start();
    const authorization = `Basic ${Buffer.from(`dashboard:${KEY}`).toString("base64")}`;
    const snapshot = await fetch(`${hub.base}/api/snapshot`, { headers: { authorization } });
    expect(snapshot.status).toBe(200);
    await snapshot.text();
    for (const origin of [hub.base, "https://foreign.example"]) {
      const ws = new WebSocket(hub.base.replace("http:", "ws:"), { headers: { authorization, origin } });
      const error = await new Promise<Error>((resolve, reject) => {
        ws.once("error", resolve);
        ws.once("open", () => { ws.terminate(); reject(new Error("browser credentials accepted")); });
      });
      expect(error.message).toContain("401");
    }
  });

  it("requires hello, binds host identity, and pushes a committed message only to its owning host", async () => {
    const hub = await start();
    const a = await hub.connect();
    const b = await hub.connect();
    const session = { host: "laptop", name: "author", vendor: "claude-code", project_key: "demo" };
    expect(await a.request("session.upsert", { op: "register", reg_id: "register-author", session })).toMatchObject({ error: { code: -32001 } });
    await a.request("hello", { host: "laptop", protocol_version: 1, agentd_version: "test" });
    await b.request("hello", { host: "server", protocol_version: 1, agentd_version: "test" });
    expect(await a.request("hello", { host: "server", protocol_version: 1, agentd_version: "test" }))
      .toMatchObject({ error: { code: -32001 } });
    const author = Results["session.upsert"].parse(result(await a.request("session.upsert", { op: "register", reg_id: "register-author", session }))).session;
    const reviewer = Results["session.upsert"].parse(result(await b.request("session.upsert", {
      op: "register", reg_id: "register-reviewer", session: { ...session, host: "server", name: "reviewer" },
    }))).session;
    expect(await a.request("inbox.list", { session_id: reviewer.id })).toMatchObject({ error: { code: -32001 } });
    const sent = Results["message.send"].parse(result(await a.request("message.send", {
      session_id: author.id, idempotency_key: "message-over-websocket",
      message: { from: "forged@host", to: [reviewer.handle], body: "hello" },
    })));
    await b.request("status"); // response follows the delivery on the same recipient connection
    expect(b.deliveries).toMatchObject([{ session_id: reviewer.id, seq: 1, wake: true, message: { id: sent.id, from: author.handle } }]);
    expect(a.deliveries).toEqual([]);
    expect(hub.db.prepare("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 1 });
    // Notifications execute with the same validation/authorization and do not need an RPC id.
    a.ws.send(JSON.stringify({ jsonrpc: "2.0", method: "session.heartbeat", params: { session_id: author.id, state: "idle" } }));
    await a.request("status");
    expect(hub.db.prepare("SELECT state FROM sessions WHERE id = ?").get(author.id)).toEqual({ state: "idle" });
    expect(await a.request("receipt.mark", { session_id: author.id, ids: [], state: "read" })).toMatchObject({ error: { code: -32602 } });
  });

  it("authenticates SSE, streams committed events, and includes deliveries in snapshots", async () => {
    const hub = await start();
    const denied = await fetch(`${hub.base}/api/events`);
    expect(denied.status).toBe(401);
    await denied.text();
    const controller = new AbortController();
    const response = await fetch(`${hub.base}/api/events`, { headers: { authorization: `Bearer ${KEY}` }, signal: controller.signal });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
      const client = await hub.connect();
      await client.request("hello", { host: "laptop", protocol_version: 1, agentd_version: "test" });
      const session = Results["session.upsert"].parse(result(await client.request("session.upsert", {
        op: "register", reg_id: "register-sse", session: { host: "laptop", name: "author", vendor: "other" },
      }))).session;
      const event = new TextDecoder().decode((await reader.read()).value);
      expect(event).toContain("event: session.registered\n");
      expect(event).toContain(session.handle);
      // 64k UTF-16 units are a legal body and exceed Node's normal stream highWaterMark.
      const body = "😀".repeat(32_000);
      const sent = await client.request("message.send", {
        session_id: session.id, idempotency_key: "message-snapshot",
        message: { from: "", to: [session.handle], body },
      });
      Results["message.send"].parse(result(sent));
      const decoder = new TextDecoder();
      let events = "";
      while (!events.includes("event: delivery.created\n") || !events.endsWith("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE disconnected while sending a valid large event");
        events += decoder.decode(chunk.value, { stream: true });
      }
      expect(events).toContain("event: message.sent\n");
      expect(events).toContain(body);
      expect(events).not.toContain("event: deliver\n");
      const snapshot = await fetch(`${hub.base}/api/snapshot`, { headers: { authorization: `Bearer ${KEY}` } });
      const snapshotBody = await snapshot.json();
      expect(snapshotBody).toMatchObject({
        hosts: [{ name: "laptop" }], sessions: [{ handle: session.handle }],
        deliveries: [{ recipient: session.handle, sender: session.handle, state: "unread", seq: 1, wake: 1, preview: "😀".repeat(199) + "…" }],
      });
      expect(JSON.stringify(snapshotBody)).not.toContain(body);
    } finally { controller.abort(); await reader.cancel().catch(() => {}); }
  });

  it("snapshots every live session and only the 100 most recently ended sessions without changing state or wake", async () => {
    const hub = await start();
    hub.db.prepare("INSERT INTO hosts (name) VALUES (?)").run("laptop");
    const insert = hub.db.prepare(`INSERT INTO sessions
      (id, host, handle, name, vendor, state, wake, reg_id, started_at, last_seen_at, ended_at)
      VALUES (?, 'laptop', ?, ?, 'other', ?, ?, ?, ?, ?, ?)`);
    const started = "2026-10-25T10:00:00.000Z";
    for (let index = 0; index < 101; index++) {
      const state = index % 3 === 0 ? "active" : index % 3 === 1 ? "idle" : "unknown";
      insert.run(`live-${index}`, `live-${index}@laptop`, `live-${index}`, state,
        index % 2 === 0 ? "on" : "off", `reg-live-${index}`, started, started, null);
    }
    for (let index = 0; index < 102; index++) {
      const ended = new Date(Date.parse(started) + index * 1000).toISOString();
      insert.run(`gone-${index}`, "reused@laptop", "reused", "gone", "off", `reg-gone-${index}`, started, ended, ended);
    }
    hub.db.prepare("INSERT INTO topics(name,kind) VALUES ('shared-topic','adhoc'), ('empty-topic','adhoc')").run();
    hub.db.prepare("INSERT INTO memberships(session_id,topic_id) SELECT s.id,t.id FROM sessions s CROSS JOIN topics t WHERE t.name='shared-topic'").run();
    const response = await fetch(`${hub.base}/api/snapshot`, { headers: { authorization: `Bearer ${KEY}` } });
    expect(response.status).toBe(200);
    const snapshot: unknown = await response.json();
    const { topics } = z.object({topics:z.array(z.object({name:z.string(),current_members:z.number(),total_members:z.number(),hidden_ended_members:z.number(),members:z.array(z.string())}))}).parse(snapshot);
    const shared = topics.find(topic=>topic.name==='shared-topic');
    expect(shared).toMatchObject({current_members:101,total_members:203,hidden_ended_members:2});
    expect(shared?.members).toHaveLength(201);
    expect(shared?.members).toContain('live-0');expect(shared?.members).toContain('gone-101');
    expect(shared?.members).not.toContain('gone-0');expect(shared?.members).not.toContain('gone-1');
    expect(topics.find(topic=>topic.name==='empty-topic')).toMatchObject({current_members:0,total_members:0,hidden_ended_members:0,members:[]});
    expect(hub.db.prepare('SELECT count(*) AS n FROM memberships').get()?.n).toBe(203);
    const { sessions } = z.object({ sessions: z.array(z.object({
      id: z.string(), state: z.string(), wake: z.string(), ended_at: z.string().nullable(),
    })) }).parse(snapshot);
    expect(sessions.filter(session => session.ended_at === null)).toHaveLength(101);
    expect(sessions.filter(session => session.ended_at !== null)).toHaveLength(100);
    expect(sessions.map(session => session.id)).not.toContain("gone-0");
    expect(sessions.map(session => session.id)).not.toContain("gone-1");
    expect(sessions).toEqual(expect.arrayContaining([
      { id: "live-0", state: "active", wake: "on", ended_at: null },
      { id: "live-1", state: "idle", wake: "off", ended_at: null },
      { id: "live-2", state: "unknown", wake: "on", ended_at: null },
      { id: "gone-101", state: "gone", wake: "off", ended_at: "2026-10-25T10:01:41.000Z" },
    ]));
  });
});
