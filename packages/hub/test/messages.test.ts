import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Message, Methods, Notifications, packHeaders, Results, type StoredMessage } from "@kommutator/protocol";
import type { z } from "zod";
import { errors, RpcFault, type HubContext } from "../src/context.js";
import { HubEvents, type HubEvent } from "../src/events.js";
import { listInbox, markReceipt, readMessage, resyncDeliveries } from "../src/inbox.js";
import { getStoredMessage, sendMessage, shouldWake } from "../src/routing.js";
import { upsertSession } from "../src/sessions.js";
import { joinTopic, leaveTopic } from "../src/topics.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const NOW = "2026-10-25T12:00:00.000Z";
const peer = { host: "laptop" };

describe("message routing and inbox", () => {
  let db: DatabaseSync;
  let ctx: HubContext;
  let events: HubEvent[];
  let counter: number;
  let snapshotDirectory: string | undefined;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(schema);
    counter = 0;
    events = [];
    ctx = { db, events: new HubEvents(() => NOW), now: () => NOW, newId: () => `message-${++counter}` };
    ctx.events.subscribe((event) => { events.push(event); });
    db.prepare("INSERT INTO hosts(name) VALUES (?)").run("laptop");
    db.prepare("INSERT INTO hosts(name) VALUES (?)").run("server");
    const insert = db.prepare(`INSERT INTO sessions(id, host, handle, name, role, vendor, reg_id, started_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'claude-code', ?, ?, ?)`);
    for (const [id, host, role] of [["a", "laptop", "author"], ["b", "laptop", "executor"], ["c", "server", "executor"], ["isolated", "server", "executor"], ["gone", "laptop", "executor"]]) {
      if (!id || !host || !role) throw new Error("invalid fixture");
      insert.run(id, host, `${id}@${host}`, id, role, `register-${id}`, NOW, NOW);
      if (id !== "isolated") db.prepare("INSERT INTO memberships(session_id, topic_id) SELECT ?, id FROM topics WHERE name = 'global'").run(id);
    }
    db.prepare("UPDATE sessions SET ended_at = ?, state = 'gone' WHERE id = 'gone'").run(NOW);
    db.prepare("INSERT INTO topics(name, kind) VALUES ('project:private', 'project')").run();
    db.prepare("INSERT INTO memberships(session_id, topic_id) SELECT 'c', id FROM topics WHERE name = 'project:private'").run();
  });
  afterEach(() => {
    db.close();
    if (snapshotDirectory) rmSync(snapshotDirectory, { recursive: true, force: true });
    snapshotDirectory = undefined;
  });

  function params(to: string[], changes: Partial<z.input<typeof Message>> = {}, sender = "a", key = `send-key-${counter + 1}`) {
    return Methods["message.send"].parse({
      session_id: sender,
      idempotency_key: key,
      message: { from: "forged@server", to, body: "first line\nsecond line", ...changes },
    });
  }

  function inbox(sessionId = "b", changes: Partial<z.input<(typeof Methods)["inbox.list"]>> = {}) {
    return listInbox(ctx, sessionId === "c" ? { host: "server" } : peer,
      Methods["inbox.list"].parse({ session_id: sessionId, ...changes }));
  }

  function stored(id: string): StoredMessage {
    const message = getStoredMessage(ctx, id);
    if (!message) throw new Error("expected stored message");
    return message;
  }

  function projectFixture() {
    db.exec("UPDATE sessions SET project_key = 'private'; INSERT INTO memberships(session_id, topic_id) SELECT s.id, t.id FROM sessions s CROSS JOIN topics t WHERE t.name = 'project:private' AND s.id != 'c'");
  }

  it("routes project snapshots by exact project membership, active/idle state and inclusive heartbeat boundary", () => {
    projectFixture();
    db.prepare("UPDATE sessions SET state = 'idle', last_seen_at = ? WHERE id = 'b'").run("2026-10-25T11:59:00.000Z");
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = 'c'").run("2026-10-25T11:58:59.999Z");
    db.exec("UPDATE sessions SET project_key = 'other' WHERE id = 'isolated'");
    const sent = sendMessage(ctx, peer, params([" @PROJECT "]));
    expect(sent.deliveries).toEqual({ b: "unread" });
    expect(stored(sent.id).to).toEqual(["@project"]);
    expect(db.prepare("SELECT target_type, target_id FROM message_targets WHERE message_id = ?").get(sent.id))
      .toEqual({ target_type: "project", target_id: "private" });
    expect(db.prepare("SELECT wake FROM deliveries WHERE message_id = ?").get(sent.id)).toEqual({ wake: 1 });
  });

  it.each(["active", "idle"])("excludes an otherwise eligible %s project peer exactly one millisecond past the freshness boundary", state => {
    projectFixture();
    db.exec("UPDATE sessions SET project_key = 'other' WHERE id NOT IN ('a', 'b')");
    db.prepare("UPDATE sessions SET state = ?, last_seen_at = ? WHERE id = 'b'")
      .run(state, "2026-10-25T11:59:00.000Z");
    expect(sendMessage(ctx, peer, params(["@project"])).deliveries).toEqual({ b: "unread" });

    ctx.now = () => "2026-10-25T12:00:00.001Z";
    expect(sendMessage(ctx, peer, params(["@project"])).deliveries).toEqual({});
    expect(sendMessage(ctx, peer, params(["topic:project:private"])).deliveries).toHaveProperty("b");
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'b'").get()).toEqual({ next_seq: 3 });
  });

  it.each(["unknown", "gone", "missing-membership", "invalid-time", "ended"])("excludes project peer with %s without changing the durable topic audience", reason => {
    projectFixture();
    db.exec("DELETE FROM memberships WHERE session_id IN ('c', 'isolated') AND topic_id = (SELECT id FROM topics WHERE name = 'project:private')");
    if (reason === "missing-membership") db.exec("DELETE FROM memberships WHERE session_id = 'b' AND topic_id = (SELECT id FROM topics WHERE name = 'project:private')");
    else if (reason === "invalid-time") db.exec("UPDATE sessions SET last_seen_at = 'bad' WHERE id = 'b'");
    else if (reason === "ended") db.prepare("UPDATE sessions SET ended_at = ? WHERE id = 'b'").run(NOW);
    else db.prepare("UPDATE sessions SET state = ? WHERE id = 'b'").run(reason);
    expect(sendMessage(ctx, peer, params(["@project"])).deliveries).toEqual({});
    expect(sendMessage(ctx, peer, params(["topic:project:private"])).deliveries).toHaveProperty("gone");
  });

  it("rejects missing sender project, membership and forged host before any inserts", () => {
    expect(() => sendMessage(ctx, peer, params(["@project", "all"]))).toThrow("inspect whoami");
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
    projectFixture();
    db.exec("DELETE FROM memberships WHERE session_id = 'a' AND topic_id = (SELECT id FROM topics WHERE name = 'project:private')");
    expect(() => sendMessage(ctx, peer, params(["@project"]))).toThrow("membership required");
    expect(() => sendMessage(ctx, { host: "server" }, params(["@project"]))).toThrow("does not belong");
    expect(db.prepare("SELECT count(*) AS n FROM message_targets").get()).toEqual({ n: 0 });
  });

  it("replays the original project delivery sequences even after membership and heartbeat changes", () => {
    projectFixture();
    const input = params(["@project"], {}, "a", "project-replay");
    const first = sendMessage(ctx, peer, input);
    const deliveries = db.prepare("SELECT * FROM deliveries").all();
    db.exec("DELETE FROM memberships WHERE session_id = 'a'; UPDATE sessions SET state = 'gone', last_seen_at = 'bad' WHERE id != 'a'");
    expect(sendMessage(ctx, peer, input)).toEqual({ ...first, replayed: true });
    expect(db.prepare("SELECT * FROM deliveries").all()).toEqual(deliveries);
    expect(() => sendMessage(ctx, peer, { ...input, message: { ...input.message, body: "changed" } })).toThrow("different message");
  });

  it("keeps zero-recipient replay empty after peers become eligible and unions explicit self targets", () => {
    projectFixture();
    db.exec("UPDATE sessions SET state = 'unknown' WHERE id != 'a'");
    const input = params(["@project"], {}, "a", "empty-project");
    const first = sendMessage(ctx, peer, input);
    expect(first.deliveries).toEqual({});
    db.exec("UPDATE sessions SET state = 'active' WHERE id = 'b'");
    expect(sendMessage(ctx, peer, input)).toEqual({ ...first, replayed: true });
    expect(sendMessage(ctx, peer, params(["@project", "b@laptop", "a@laptop"])).deliveries).toEqual({ a: "unread", b: "unread" });
  });

  it.each([{ kind: "topic", priority: "normal", wake: "on", expected: 0 },
    { kind: "request", priority: "fyi", wake: "on", expected: 0 },
    { kind: "request", priority: "normal", wake: "off", expected: 0 },
    { kind: "request", priority: "normal", wake: "on", expected: 1 }] as const)("preserves project wake policy: %j", rule => {
    projectFixture();
    db.prepare("UPDATE sessions SET wake = ? WHERE id = 'b'").run(rule.wake);
    const sent = sendMessage(ctx, peer, params(["@project"], { kind: rule.kind, priority: rule.priority }));
    expect(db.prepare("SELECT wake FROM deliveries WHERE message_id = ? AND session_id = 'b'").get(sent.id)).toEqual({ wake: rule.expected });
  });

  it("derives authorship, identity and root metadata and emits valid deliveries after commit", () => {
    const committedCounts: number[] = [];
    ctx.events.subscribe(() => {
      // BEGIN succeeds only if the handler has committed its own transaction.
      db.exec("BEGIN");
      committedCounts.push(Number(db.prepare("SELECT count(*) AS n FROM deliveries").get()?.n));
      db.exec("ROLLBACK");
    });
    const result = sendMessage(ctx, peer, params([" B@LAPTOP ", "@role:executor", "b@laptop"], {
      id: "forged-id", thread_id: "forged-thread", created_at: "2000-01-01T00:00:00.000Z", hops: 99,
    }));
    expect(result).toEqual({ id: "message-1", deliveries: { b: "unread", c: "unread" }, replayed: false });
    expect(stored(result.id)).toMatchObject({
      id: "message-1", from: "a@laptop", to: ["@role:executor", "b@laptop"],
      thread_id: "message-1", reply_to: null, hops: 0, created_at: NOW,
    });
    expect(events.map((event) => event.type)).toEqual(["message.sent", "delivery.created", "deliver", "delivery.created", "deliver"]);
    expect(committedCounts).toEqual([2, 2, 2, 2, 2]);
    const pushes = events.filter((event) => event.type === "deliver").map((event) => event.data as { host: string; notification: unknown });
    expect(pushes.map((push) => push.host)).toEqual(["laptop", "server"]);
    expect(pushes.map((push) => Notifications.deliver.parse(push.notification))).toMatchObject([
      { session_id: "b", seq: 1, wake: true }, { session_id: "c", seq: 1, wake: true },
    ]);
  });

  it("keeps topic posts readable by their author without self unread, push or resync", () => {
    const input = params(["topic:global"], { kind: "topic" });
    const sent = sendMessage(ctx, peer, input);
    expect(sent.deliveries).toEqual({ b: "unread", c: "unread", gone: "unread" });
    expect(inbox("a", { unread_only: true }).headers).toEqual([]);
    expect(inbox("a").headers).toEqual([]);
    expect(inbox("b", { unread_only: true }).headers.map(header => header.id)).toEqual([sent.id]);
    expect(events.filter(event => event.type === "deliver").map(event =>
      (event.data as { notification: { session_id: string } }).notification.session_id)).toEqual(["b", "c"]);
    expect(resyncDeliveries(ctx, peer, { acked: { a: 0, b: 0 } })).toEqual({ replayed: 1 });
    expect(sendMessage(ctx, peer, input)).toEqual({ ...sent, replayed: true });
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'a'").get()).toEqual({ next_seq: 1 });
    db.prepare("UPDATE sessions SET handle = 'renamed@laptop' WHERE id = 'a'").run();
    expect(readMessage(ctx, peer, { session_id: "a", id: sent.id })).toMatchObject({ message: { from: "a@laptop" }, state: "read" });
    expect(events.filter(event => event.type === "delivery.read")).toEqual([]);
    expect(inbox("b", { unread_only: true }).headers).toHaveLength(1);
    expect(() => readMessage(ctx, { host: "server" }, { session_id: "isolated", id: sent.id })).toThrow("not in this session's inbox");
    expect(() => readMessage(ctx, { host: "server" }, { session_id: "a", id: sent.id })).toThrow("session does not belong");
    const next = sendMessage(ctx, peer, params(["renamed@laptop"]));
    expect(inbox("a").headers).toMatchObject([{ id: next.id, seq: 1 }]);
  });

  it("retains a sole subscriber's topic post with no deliveries or receipt", () => {
    db.prepare("DELETE FROM memberships WHERE session_id != 'a'").run();
    const sent = sendMessage(ctx, peer, params(["topic:global"], { kind: "topic" }));
    expect(sent.deliveries).toEqual({});
    expect(stored(sent.id).to).toEqual(["topic:global"]);
    expect(readMessage(ctx, peer, { session_id: "a", id: sent.id }).message.id).toBe(sent.id);
    expect(db.prepare("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 0 });
    expect(events.map(event => event.type)).toEqual(["message.sent"]);
  });

  it("rejects replies redirected by reuse of the parent's historical author handle", () => {
    const parent = sendMessage(ctx, peer, params(["topic:global"], { kind: "topic" }));
    db.prepare("UPDATE sessions SET handle = 'renamed@laptop' WHERE id = 'a'").run();
    db.prepare("UPDATE sessions SET handle = 'a@laptop' WHERE id = 'c'").run();
    expect(() => sendMessage(ctx, peer, params(["a@laptop"], { reply_to: parent.id }, "b")))
      .toThrow("reply author handle no longer belongs to the original session");
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
    expect(inbox("c").headers).toHaveLength(1);
  });

  it("replays a committed private reply after the parent's historical handle is reused", () => {
    const parent = sendMessage(ctx, peer, params(["topic:global"], { kind: "topic" }));
    const input = params(["a@laptop"], { reply_to: parent.id }, "b");
    const reply = sendMessage(ctx, peer, input);
    db.prepare("UPDATE sessions SET handle = 'renamed@laptop' WHERE id = 'a'").run();
    db.prepare("UPDATE sessions SET handle = 'a@laptop' WHERE id = 'c'").run();
    const eventCount = events.length;
    expect(sendMessage(ctx, peer, input)).toEqual({ ...reply, replayed: true });
    expect(events).toHaveLength(eventCount);
    expect(inbox("a").headers.map(header => header.id)).toEqual([reply.id]);
    expect(inbox("c").headers.map(header => header.id)).toEqual([parent.id]);
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'a'").get()).toEqual({ next_seq: 2 });
  });

  it("preserves historical topic self deliveries through inbox, resync, replay and read", () => {
    const input = params(["topic:global"], { kind: "topic" });
    const sent = sendMessage(ctx, peer, input);
    // Model a committed pre-upgrade topic delivery without changing its replay payload.
    db.prepare("INSERT INTO deliveries(message_id, session_id, seq, state, wake, updated_at) VALUES (?, 'a', 1, 'unread', 0, ?)").run(sent.id, NOW);
    db.prepare("UPDATE sessions SET next_seq = 2 WHERE id = 'a'").run();
    expect(inbox("a", { unread_only: true }).headers).toMatchObject([{ id: sent.id, seq: 1, state: "unread" }]);
    expect(resyncDeliveries(ctx, peer, { acked: { a: 0 } })).toEqual({ replayed: 1 });
    expect(events.at(-1)).toMatchObject({ type: "deliver", data: { notification: { session_id: "a", seq: 1 } } });
    expect(sendMessage(ctx, peer, input)).toEqual({ ...sent, deliveries: { a: "unread", b: "unread", c: "unread", gone: "unread" }, replayed: true });
    expect(inbox("a", { unread_only: true }).headers).toHaveLength(1);
    readMessage(ctx, peer, { session_id: "a", id: sent.id });
    expect(inbox("a", { unread_only: true }).headers).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "delivery.read", data: { session_id: "a", message_id: sent.id } });
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'a'").get()).toEqual({ next_seq: 2 });
  });

  it("preserves explicit self delivery alongside topic addressing regardless of message kind", () => {
    for (const kind of ["topic", "dm"] as const) {
      const sent = sendMessage(ctx, peer, params(["topic:global", "a@laptop"], { kind }));
      expect(sent.deliveries).toEqual({ a: "unread", b: "unread", c: "unread", gone: "unread" });
    }
    expect(inbox("a", { unread_only: true }).headers.map(header => header.seq)).toEqual([1, 2]);
  });

  it("rejects unknown or invisible direct handles atomically and does not consume sequences", () => {
    for (const address of ["missing@laptop", "isolated@server", "gone@laptop"]) {
      expect(() => sendMessage(ctx, peer, params(["b@laptop", address]))).toThrow("unknown recipient handle");
    }
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(events).toEqual([]);
    sendMessage(ctx, peer, params(["b@laptop"]));
    expect(inbox().headers.map((header) => header.seq)).toEqual([1]);
  });

  it("requires membership for topic addressing despite a shared global topic", () => {
    expect(() => sendMessage(ctx, peer, params(["topic:project:private"], { kind: "topic" }))).toThrow("topic membership required");
    const result = sendMessage(ctx, peer, params(["topic:global", "all"], { kind: "broadcast" }));
    expect(Object.keys(result.deliveries).sort()).toEqual(["a", "b", "c", "gone"]);
    expect(events.filter((event) => event.type === "deliver").map((event) => (event.data as { notification: { wake: boolean } }).notification.wake))
      .toEqual([false, false, false]);
  });

  it("retains topic deliveries while gone and resyncs them after reincarnation without marking read", () => {
    const original = params(["topic:global", "@role:executor"], { kind: "request" });
    const sent = sendMessage(ctx, peer, original);
    expect(sent.deliveries["gone"]).toBe("unread");
    expect(events.filter(event => event.type === "deliver").some(event =>
      (event.data as { notification: { session_id: string } }).notification.session_id === "gone")).toBe(false);
    expect(() => resyncDeliveries(ctx, peer, { acked: { gone: 0 } })).toThrow("session is gone");
    const restored = upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "reincarnate", reg_id: "revive-gone", session: { id: "gone", host: "laptop", name: "gone", vendor: "claude-code" },
    }));
    expect(restored.session.incarnation).toBe(1);
    const before = db.prepare("SELECT * FROM deliveries WHERE session_id = 'gone'").all();
    expect(resyncDeliveries(ctx, peer, { acked: { gone: 0 } })).toEqual({ replayed: 1 });
    expect(events.at(-1)).toMatchObject({ type: "deliver", data: { notification: { session_id: "gone", seq: 1, wake: true } } });
    expect(inbox("gone", { unread_only: true }).headers).toMatchObject([{ id: sent.id, seq: 1, state: "unread" }]);
    expect(sendMessage(ctx, peer, original)).toMatchObject({ id: sent.id, replayed: true });
    expect(db.prepare("SELECT * FROM deliveries WHERE session_id = 'gone'").all()).toEqual(before);
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'gone'").get()).toEqual({ next_seq: 2 });
    db.prepare("UPDATE sessions SET wake = 'off' WHERE id = 'gone'").run();
    resyncDeliveries(ctx, peer, { acked: { gone: 0 } });
    expect(events.at(-1)).toMatchObject({ data: { notification: { wake: false } } });
    readMessage(ctx, peer, { session_id: "gone", id: sent.id });
    expect(resyncDeliveries(ctx, peer, { acked: { gone: 0 } })).toEqual({ replayed: 0 });
  });

  it("captures membership at send time without granting history to later subscribers", () => {
    for (const session_id of ["a", "b"]) joinTopic(ctx, peer, { session_id, name: "offline-feedback" });
    const first = sendMessage(ctx, peer, params(["topic:offline-feedback"], { kind: "topic" }));
    leaveTopic(ctx, peer, { session_id: "b", name: "offline-feedback" });
    const second = sendMessage(ctx, peer, params(["topic:offline-feedback"], { kind: "topic" }));
    joinTopic(ctx, peer, { session_id: "b", name: "offline-feedback" });
    joinTopic(ctx, { host: "server" }, { session_id: "c", name: "offline-feedback" });
    expect(inbox("b").headers.map(header => header.id)).toEqual([first.id]);
    expect(inbox("c").headers).toEqual([]);
    expect(() => readMessage(ctx, peer, { session_id: "b", id: second.id })).toThrow("not in this session's inbox");
    const third = sendMessage(ctx, peer, params(["topic:offline-feedback"], { kind: "topic" }));
    expect(inbox("b").headers.map(header => header.id)).toEqual([first.id, third.id]);
    expect(inbox("c").headers.map(header => header.id)).toEqual([third.id]);
  });

  it("persists absent subscribers' topic mail across database reopen without waking or granting later members history", () => {
    joinTopic(ctx, peer, { session_id: "a", name: "durable-feedback" });
    db.prepare("INSERT INTO memberships(session_id, topic_id) SELECT 'gone', id FROM topics WHERE name = 'durable-feedback'").run();
    const original = params(["topic:durable-feedback"], { kind: "topic" });
    const sent = sendMessage(ctx, peer, original);
    expect(sent.deliveries).toEqual({ gone: "unread" });
    expect(events.filter(event => event.type === "deliver")).toHaveLength(0);

    snapshotDirectory = mkdtempSync(join(tmpdir(), "kom-topic-recovery-"));
    const snapshot = join(snapshotDirectory, "hub.db");
    db.prepare("VACUUM INTO ?").run(snapshot);
    db.close();
    db = new DatabaseSync(snapshot);
    ctx = { ...ctx, db };
    joinTopic(ctx, peer, { session_id: "b", name: "durable-feedback" });
    upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "reincarnate", reg_id: "durable-revive", session: { id: "gone", host: "laptop", name: "gone", vendor: "claude-code" },
    }));
    events.length = 0;
    expect(resyncDeliveries(ctx, peer, { acked: { gone: 0 } })).toEqual({ replayed: 1 });
    expect(events).toMatchObject([{ type: "deliver", data: { notification: { session_id: "gone", seq: 1, wake: false } } }]);
    expect(inbox("gone", { unread_only: true }).headers).toMatchObject([{ id: sent.id, state: "unread", wake: false }]);
    expect(inbox("b").headers).toEqual([]);
    expect(() => readMessage(ctx, peer, { session_id: "b", id: sent.id })).toThrow("not in this session's inbox");
    expect(sendMessage(ctx, peer, original)).toMatchObject({ id: sent.id, replayed: true, deliveries: { gone: "unread" } });
    expect(inbox("gone").headers).toHaveLength(1);
  });

  it("keeps all and role addressing live-only even when a gone session retains membership", () => {
    expect(Object.keys(sendMessage(ctx, peer, params(["all"])).deliveries).sort()).toEqual(["a", "b", "c"]);
    expect(Object.keys(sendMessage(ctx, peer, params(["@role:executor"])).deliveries).sort()).toEqual(["b", "c"]);
  });

  it("rejects malformed addresses and a caller from the wrong host", () => {
    const malformed = {
      session_id: "a", idempotency_key: "invalid-address-key",
      message: Message.parse({ from: "forged@server", to: ["not an address"], body: "invalid" }),
    };
    expect(() => sendMessage(ctx, peer, malformed)).toThrow(RpcFault);
    expect(() => sendMessage(ctx, { host: "server" }, params(["b@laptop"]))).toThrow("session does not belong");
    expect(() => listInbox(ctx, { host: "server" }, Methods["inbox.list"].parse({ session_id: "b" }))).toThrow("session does not belong");
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
  });

  it("rolls back every recipient sequence and all rows if a delivery insert fails", () => {
    db.exec(`CREATE TRIGGER fail_delivery BEFORE INSERT ON deliveries WHEN NEW.session_id = 'c'
      BEGIN SELECT RAISE(ABORT, 'injected delivery failure'); END`);
    expect(() => sendMessage(ctx, peer, params(["b@laptop", "c@server"]))).toThrow("injected delivery failure");
    for (const table of ["messages", "message_targets", "deliveries"]) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'b'").get()).toEqual({ next_seq: 1 });
    expect(events).toEqual([]);
    db.exec("DROP TRIGGER fail_delivery");
    sendMessage(ctx, peer, params(["b@laptop", "c@server"]));
    expect(inbox().headers.map((header) => header.seq)).toEqual([1]);
  });

  it("replays a lost acknowledgement without recomputing recipients, allocating sequences or emitting events", () => {
    const original = params(["@role:executor"]);
    const first = sendMessage(ctx, peer, original);
    markReceipt(ctx, peer, { session_id: "b", ids: [first.id], state: "read" });
    db.prepare("UPDATE sessions SET ended_at = ? WHERE id = 'b'").run(NOW);
    db.prepare("DELETE FROM memberships WHERE session_id = 'c'").run();
    const eventCount = events.length;
    expect(sendMessage(ctx, peer, original)).toEqual({ id: first.id, deliveries: { b: "read", c: "unread" }, replayed: true });
    expect(events).toHaveLength(eventCount);
    expect(db.prepare("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'c'").get()).toEqual({ next_seq: 2 });
  });

  it("rejects idempotency-key reuse for changed content or another caller", () => {
    const original = params(["b@laptop"]);
    const first = sendMessage(ctx, peer, original);
    expect(() => sendMessage(ctx, peer, { ...original, message: { ...original.message, body: "changed" } }))
      .toThrow("idempotency key already used");
    expect(() => sendMessage(ctx, peer, { ...original, session_id: "b" })).toThrow("idempotency key already used");
    expect(sendMessage(ctx, peer, { ...original, message: { ...original.message, to: [" B@LAPTOP ", "b@laptop"] } }))
      .toMatchObject({ id: first.id, replayed: true });
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  it("gives full-ID guidance for missing and inaccessible reply parents without revealing existence", () => {
    const root = sendMessage(ctx, peer, params(["b@laptop"]));
    const guidance = "reply parent is not accessible; use the full message ID returned by inbox or read (prefixes are not supported)";
    for (const id of [root.id, "19d61573", "missing-message"]) {
      expect(() => sendMessage(ctx, { host: "server" }, params(["a@laptop"], { reply_to: id }, "c")))
        .toThrow(guidance);
    }
    expect(db.prepare("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 1 });
  });

  it("derives reply thread and increasing hops, rejecting an inaccessible parent", () => {
    const root = sendMessage(ctx, peer, params(["b@laptop"]));
    expect(() => sendMessage(ctx, { host: "server" }, params(["a@laptop"], { reply_to: root.id }, "c")))
      .toThrow("reply parent is not accessible");
    let parentId = root.id;
    for (let hop = 1; hop <= 4; hop++) {
      const sender = hop % 2 === 1 ? "b" : "a";
      const to = sender === "a" ? "b@laptop" : "a@laptop";
      const reply = sendMessage(ctx, peer, params([to], { reply_to: parentId, thread_id: "forged-thread", hops: 0 }, sender));
      expect(stored(reply.id)).toMatchObject({ thread_id: root.id, reply_to: parentId, hops: hop });
      parentId = reply.id;
    }
    const last = events.at(-1)?.data as { notification: { wake: boolean } };
    expect(last.notification.wake).toBe(false);
  });

  it("paginates with gap-free sequences and does not mark listed headers read", () => {
    for (let i = 0; i < 3; i++) sendMessage(ctx, peer, params(["b@laptop"], { body: `${"😀".repeat(210)}\nignored` }));
    const first = inbox("b", { limit: 2 });
    expect(first.headers.map((header) => header.seq)).toEqual([1, 2]);
    expect(first).toMatchObject({ cursor: 2, more: true });
    expect(Array.from(first.headers[0]?.preview ?? "")).toHaveLength(200);
    const second = inbox("b", { since_seq: first.cursor, limit: 2 });
    expect(second.headers.map((header) => header.seq)).toEqual([3]);
    expect(second).toMatchObject({ cursor: 3, more: false });
    expect(inbox("b", { since_seq: second.cursor })).toEqual({ headers: [], cursor: 3, more: false });
    expect(inbox("b", { unread_only: true }).headers).toHaveLength(3);
    expect(Results["inbox.list"].safeParse(first).success).toBe(true);
  });

  it("returns oldest unread even with a cursor and preserves the sixth header after packing", () => {
    for (let i = 0; i < 6; i++) sendMessage(ctx, peer, params(["b@laptop"]));
    const first = inbox("b", { unread_only: true, since_seq: 999 });
    expect(first.headers.map((header) => header.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    const packed = packHeaders(first.headers);
    expect(packed.shown).toHaveLength(5);
    markReceipt(ctx, peer, { session_id: "b", ids: packed.shown.map((header) => header.id), state: "read" });
    const afterRestart = listInbox({ ...ctx }, peer, Methods["inbox.list"].parse({ session_id: "b", since_seq: 999, unread_only: true }));
    expect(afterRestart.headers.map((header) => [header.id, header.seq])).toEqual([["message-6", 6]]);
  });

  it("read and ack affect only the caller's deliveries, and unread retries never revert read", () => {
    const first = sendMessage(ctx, peer, params(["b@laptop", "c@server"]));
    const onlyC = sendMessage(ctx, peer, params(["c@server"]));
    expect(readMessage(ctx, peer, { session_id: "a", id: first.id })).toEqual({ message: stored(first.id), state: "read" });
    expect(inbox("b", { unread_only: true }).headers.map(header => header.id)).toEqual([first.id]);
    expect(() => readMessage(ctx, peer, { session_id: "b", id: onlyC.id })).toThrow("not in this session's inbox");
    expect(readMessage(ctx, peer, { session_id: "b", id: first.id })).toEqual({ message: stored(first.id), state: "read" });
    const eventCount = events.length;
    readMessage(ctx, peer, { session_id: "b", id: first.id });
    expect(markReceipt(ctx, peer, { session_id: "b", ids: [first.id, onlyC.id, "missing"], state: "unread" })).toEqual({ ok: true, counts: { requested: 3, matched: 1, marked_read: 0, already_read: 1, unmatched: 2 } });
    markReceipt(ctx, peer, { session_id: "b", ids: [onlyC.id], state: "read" });
    expect(events).toHaveLength(eventCount);
    expect(inbox().headers[0]?.state).toBe("read");
    expect(inbox("c").headers.map((header) => header.state)).toEqual(["unread", "unread"]);
    expect(markReceipt(ctx, { host: "server" }, { session_id: "c", ids: [first.id, first.id], state: "read" })).toEqual({ ok: true, counts: { requested: 1, matched: 1, marked_read: 1, already_read: 0, unmatched: 0 } });
    expect(inbox("c").headers.map((header) => header.state)).toEqual(["read", "unread"]);
    expect(events.at(-1)).toMatchObject({ type: "delivery.read", data: { session_id: "c", message_id: first.id, state: "read", cause: "ack" } });
  });

  it("reports distinct receipt matches without revealing other recipients and remains idempotent", () => {
    const read = sendMessage(ctx, peer, params(["b@laptop"]));
    const unread = sendMessage(ctx, peer, params(["b@laptop"]));
    const foreign = sendMessage(ctx, peer, params(["c@server"]));
    readMessage(ctx, peer, { session_id: "b", id: read.id });
    const before = events.length;
    const request = { session_id: "b", ids: [read.id, unread.id, unread.id, foreign.id, "missing"], state: "read" as const };
    expect(markReceipt(ctx, peer, request)).toEqual({ ok: true, counts: {
      requested: 4, matched: 2, marked_read: 1, already_read: 1, unmatched: 2,
    } });
    expect(events.slice(before)).toMatchObject([{ type: "delivery.read", data: { message_id: unread.id } }]);
    expect(markReceipt(ctx, peer, request)).toEqual({ ok: true, counts: {
      requested: 4, matched: 2, marked_read: 0, already_read: 2, unmatched: 2,
    } });
    expect(events).toHaveLength(before + 1);
    expect(inbox("b", { unread_only: true }).headers).toEqual([]);
    expect(inbox("c", { unread_only: true }).headers.map(header => header.id)).toEqual([foreign.id]);
    expect(markReceipt(ctx, peer, { session_id: "b", ids: [foreign.id], state: "read" }))
      .toEqual(markReceipt(ctx, peer, { session_id: "b", ids: ["missing"], state: "read" }));
    const stillUnread = sendMessage(ctx, peer, params(["b@laptop"]));
    expect(markReceipt(ctx, peer, { session_id: "b", ids: [stillUnread.id], state: "unread" })).toEqual({ ok: true, counts: {
      requested: 1, matched: 1, marked_read: 0, already_read: 0, unmatched: 0,
    } });
    expect(inbox("b", { unread_only: true }).headers.map(header => header.id)).toEqual([stillUnread.id]);
  });

  it("rejects host spoofing for read and receipt changes", () => {
    const sent = sendMessage(ctx, peer, params(["c@server"]));
    expect(() => readMessage(ctx, peer, { session_id: "c", id: sent.id })).toThrow(RpcFault);
    try {
      markReceipt(ctx, peer, { session_id: "c", ids: [sent.id], state: "read" });
      throw new Error("expected authorization failure");
    } catch (error) {
      expect(error).toMatchObject({ code: errors.unauthorized });
    }
    expect(inbox("c").headers[0]?.state).toBe("unread");
  });

  it("keeps the sender's original handle in messages, headers and replay after a rename", () => {
    const original = params(["b@laptop"]);
    const sent = sendMessage(ctx, peer, original);
    db.prepare("UPDATE sessions SET name = 'renamed', handle = 'renamed@laptop' WHERE id = 'a'").run();
    expect(stored(sent.id).from).toBe("a@laptop");
    expect(inbox().headers[0]?.from).toBe("a@laptop");
    expect(sendMessage(ctx, peer, original)).toMatchObject({ id: sent.id, replayed: true });
    resyncDeliveries(ctx, peer, { acked: { b: 0 } });
    expect(events.at(-1)).toMatchObject({ type: "deliver", data: { notification: { message: { from: "a@laptop" } } } });
    // Older hand-written fixtures have no immutable handle; keep them readable.
    db.prepare("UPDATE messages SET from_handle = '' WHERE id = ?").run(sent.id);
    expect(stored(sent.id).from).toBe("renamed@laptop");
    expect(inbox().headers[0]?.from).toBe("renamed@laptop");
  });

  it("stores wake once and filters waking headers without changing the historical decision", () => {
    sendMessage(ctx, peer, params(["b@laptop"]));
    sendMessage(ctx, peer, params(["b@laptop"], { priority: "fyi" }));
    sendMessage(ctx, peer, params(["b@laptop"], { kind: "topic" }));
    db.prepare("UPDATE sessions SET wake = 'off' WHERE id = 'b'").run();
    sendMessage(ctx, peer, params(["b@laptop"]));
    sendMessage(ctx, peer, params(["b@laptop"], { origin: "human", force_wake: true }));
    db.prepare("UPDATE sessions SET wake = 'on' WHERE id = 'b'").run();
    sendMessage(ctx, peer, params(["b@laptop"], { priority: "fyi", origin: "human", force_wake: true }));
    expect(inbox().headers.map((header) => header.wake)).toEqual([true, false, false, false, false, true]);
    expect(inbox("b", { unread_only: true, waking_only: true, since_seq: 999 }).headers.map((header) => header.seq)).toEqual([1, 6]);
    expect(inbox("b", { waking_only: true, since_seq: 1, limit: 1 })).toMatchObject({ cursor: 6, more: false });
    expect(events.filter((event) => event.type === "delivery.created").map((event) => (event.data as { wake: boolean }).wake))
      .toEqual([true, false, false, false, false, true]);
    db.prepare("UPDATE sessions SET wake = 'off' WHERE id = 'b'").run();
    // Stop checks current DND separately; headers preserve the decision made at send time.
    expect(inbox("b", { waking_only: true }).headers.map((header) => header.seq)).toEqual([1, 6]);
    db.prepare("UPDATE sessions SET wake = 'on' WHERE id = 'b'").run();
    const beforeResync = events.length;
    expect(resyncDeliveries(ctx, peer, { acked: { b: 0 } })).toEqual({ replayed: 6 });
    expect(events.slice(beforeResync).map((event) => (event.data as { notification: { wake: boolean } }).notification.wake))
      .toEqual([true, false, false, false, false, true]);
  });

  it("replays a delivery missed while offline without allocating seq or marking it read", () => {
    const received: unknown[] = [];
    const disconnect = ctx.events.subscribe((event) => {
      if (event.type === "deliver") received.push(event.data);
    });
    disconnect();
    const sent = sendMessage(ctx, peer, params(["b@laptop"]));
    expect(received).toEqual([]);
    const before = db.prepare("SELECT * FROM deliveries WHERE session_id = 'b'").all();
    ctx.events.subscribe((event) => { if (event.type === "deliver") received.push(event.data); });
    expect(resyncDeliveries(ctx, peer, { acked: { b: 0 } })).toEqual({ replayed: 1 });
    expect(received).toMatchObject([{ host: "laptop", notification: { message: { id: sent.id }, session_id: "b", seq: 1, wake: true } }]);
    expect(db.prepare("SELECT * FROM deliveries WHERE session_id = 'b'").all()).toEqual(before);
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = 'b'").get()).toEqual({ next_seq: 2 });
    expect(events.filter((event) => event.type === "message.sent")).toHaveLength(1);
    expect(events.filter((event) => event.type === "delivery.created")).toHaveLength(1);
    expect(resyncDeliveries(ctx, peer, { acked: { b: 1 } })).toEqual({ replayed: 0 });
    expect(received).toHaveLength(1);
  });

  it("resync skips marked-read and acknowledged deliveries and applies current DND", () => {
    sendMessage(ctx, peer, params(["b@laptop"]));
    const read = sendMessage(ctx, peer, params(["b@laptop"]));
    const pending = sendMessage(ctx, peer, params(["b@laptop"]));
    markReceipt(ctx, peer, { session_id: "b", ids: [read.id], state: "read" });
    db.prepare("UPDATE sessions SET wake = 'off' WHERE id = 'b'").run();
    const previousCount = events.length;
    expect(resyncDeliveries(ctx, peer, { acked: { b: 1 } })).toEqual({ replayed: 1 });
    expect(events.slice(previousCount)).toMatchObject([
      { type: "deliver", data: { notification: { message: { id: pending.id }, seq: 3, wake: false } } },
    ]);
    expect(inbox().headers.at(-1)).toMatchObject({ state: "unread", wake: true });
    db.prepare("UPDATE sessions SET wake = 'on' WHERE id = 'b'").run();
    expect(resyncDeliveries(ctx, peer, { acked: { b: 1 } })).toEqual({ replayed: 1 });
    expect(events.at(-1)).toMatchObject({ type: "deliver", data: { notification: { seq: 3, wake: true } } });
    expect(resyncDeliveries(ctx, peer, { acked: { b: 3 } })).toEqual({ replayed: 0 });
    expect(events.filter((event) => event.type === "delivery.created")).toHaveLength(3);
  });

  it("authorizes every resync session before emitting anything", () => {
    sendMessage(ctx, peer, params(["b@laptop", "c@server"]));
    const eventCount = events.length;
    expect(() => resyncDeliveries(ctx, peer, { acked: { b: 0, c: 0 } })).toThrow("session does not belong");
    expect(() => resyncDeliveries(ctx, peer, { acked: { b: 0, missing: 0 } })).toThrow("session does not belong");
    expect(() => resyncDeliveries(ctx, {}, { acked: {} })).toThrow("hello required");
    expect(events).toHaveLength(eventCount);
    expect(resyncDeliveries(ctx, peer, { acked: {} })).toEqual({ replayed: 0 });
    expect(inbox().headers[0]?.state).toBe("unread");
  });
});

describe("wake rule", () => {
  it.each([
    { name: "normal DM", message: {}, wake: "on", expected: true },
    { name: "normal request", message: { kind: "request" }, wake: "on", expected: true },
    { name: "DM at hop limit", message: { hops: 3 }, wake: "on", expected: true },
    { name: "request at hop limit", message: { kind: "request", hops: 3 }, wake: "on", expected: true },
    { name: "DM beyond hop limit", message: { hops: 4 }, wake: "on", expected: false },
    { name: "request beyond hop limit", message: { kind: "request", hops: 4 }, wake: "on", expected: false },
    { name: "FYI DM", message: { priority: "fyi" }, wake: "on", expected: false },
    { name: "FYI request", message: { kind: "request", priority: "fyi" }, wake: "on", expected: false },
    { name: "agent force flag", message: { priority: "fyi", force_wake: true }, wake: "on", expected: false },
    { name: "human without force", message: { origin: "human", priority: "fyi" }, wake: "on", expected: false },
    { name: "human override for DM", message: { origin: "human", force_wake: true, priority: "fyi", hops: 4 }, wake: "on", expected: true },
    { name: "human override for request", message: { kind: "request", origin: "human", force_wake: true, priority: "fyi", hops: 4 }, wake: "on", expected: true },
    { name: "topic", message: { kind: "topic" }, wake: "on", expected: false },
    { name: "broadcast", message: { kind: "broadcast" }, wake: "on", expected: false },
    { name: "human override on topic", message: { kind: "topic", origin: "human", force_wake: true }, wake: "on", expected: false },
    { name: "human override on broadcast", message: { kind: "broadcast", origin: "human", force_wake: true }, wake: "on", expected: false },
    { name: "DND DM", message: {}, wake: "off", expected: false },
    { name: "DND request", message: { kind: "request" }, wake: "off", expected: false },
    { name: "DND human override", message: { origin: "human", force_wake: true }, wake: "off", expected: false },
  ] as const)("$name", ({ message, wake, expected }) => {
    const input = Message.parse({ from: "a@laptop", to: ["b@laptop"], body: "hello", ...message });
    expect(shouldWake({ wake }, input)).toBe(expected);
  });
});
