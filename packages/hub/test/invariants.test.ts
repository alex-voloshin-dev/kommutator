import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Notifications, PROTOCOL_VERSION, Results } from "@kommutator/protocol";
import type { HubPeer } from "../src/context.js";
import { openDatabase, SCHEMA_VERSION } from "../src/db.js";
import type { HubEvent } from "../src/events.js";
import { createHubRuntime, type HubRuntime } from "../src/rpc.js";

const NOW = "2026-10-25T12:00:00.000Z";
const Reply = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

describe("hub persistence invariants", () => {
  let directory: string;
  let path: string;
  let db: DatabaseSync;
  let runtime: HubRuntime;
  let peer: HubPeer;
  let events: HubEvent[];
  let reported: unknown[];
  let nextId: number;
  let nextRequest: number;

  function call(method: string, params: unknown = {}): unknown {
    const id = ++nextRequest;
    const raw = runtime.dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }), peer);
    if (raw === undefined) throw new Error("expected an RPC response");
    const reply = Reply.parse(JSON.parse(raw));
    expect(reply.id).toBe(id);
    if (reply.error) throw new Error(`${reply.error.code}: ${reply.error.message}`);
    return reply.result;
  }

  function connectRuntime(): void {
    peer = {};
    events = [];
    runtime = createHubRuntime({
      db, now: () => NOW, newId: () => `persistent-${++nextId}`,
      onError: (error) => { reported.push(error); },
    });
    runtime.events.subscribe((event) => { events.push(event); });
    call("hello", { host: "laptop", agentd_version: "test", protocol_version: PROTOCOL_VERSION });
  }

  function reopen(): void {
    db.close();
    db = openDatabase(path);
    connectRuntime();
  }

  function registration(name: string) {
    return { op: "register", reg_id: `register-${name}`, session: { host: "laptop", name, vendor: "claude-code" } };
  }

  function register(name: string) {
    return Results["session.upsert"].parse(call("session.upsert", registration(name))).session;
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "kom-persistence-"));
    path = join(directory, "hub.db");
    db = openDatabase(path);
    nextId = 0;
    nextRequest = 0;
    reported = [];
    connectRuntime();
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([5, 6])("upgrades schema %s atomically to 7 without changing delivery or replay history", version => {
    const sender = register("author");
    const recipient = register("peer");
    const input = { session_id: sender.id, idempotency_key: "migration-message", message: { from: "", to: [recipient.handle], body: "preserve" } };
    const sent = Results["message.send"].parse(call("message.send", input));
    const before = ["messages", "message_targets", "deliveries", "sessions", "session_registrations"].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    if (version === 5) db.exec("DROP TABLE retired_operations");
    db.exec(`PRAGMA user_version = ${version}`);
    reopen();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 7 });
    expect(["messages", "message_targets", "deliveries", "sessions", "session_registrations"].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(call("message.send", input)).toEqual({ ...sent, replayed: true });
    expect(db.prepare("SELECT * FROM retired_operations").all()).toEqual([]);
  });

  it("rolls back the supported migration completely on failure", () => {
    // A conflicting table models an interrupted/foreign migration, not a valid schema 5 database.
    db.exec("PRAGMA user_version = 5");
    expect(() => openDatabase(path)).toThrow();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
    expect(db.prepare("SELECT count(*) AS n FROM retired_operations").get()).toEqual({ n: 0 });
  });

  it("preserves schema-6 retirement fences through upgrade and reopen", () => {
    db.exec("INSERT INTO retired_operations(kind, operation_key) VALUES ('message', 'retired-send'), ('registration', 'retired-registration'); PRAGMA user_version = 6");
    const before = db.prepare("SELECT * FROM retired_operations ORDER BY kind").all();
    reopen();
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 7 });
    expect(db.prepare("SELECT * FROM retired_operations ORDER BY kind").all()).toEqual(before);
    reopen();
    expect(db.prepare("SELECT * FROM retired_operations ORDER BY kind").all()).toEqual(before);
    expect(() => call("session.upsert", { ...registration("retired"), reg_id: "retired-registration" }))
      .toThrow(/permanently removed/);
  });

  it("retains project provenance and its original audience after restart and peer replacement", () => {
    const sender = Results["session.upsert"].parse(call("session.upsert", {
      ...registration("author"), session: { ...registration("author").session, project_key: "same" },
    })).session;
    const recipient = Results["session.upsert"].parse(call("session.upsert", {
      ...registration("peer"), session: { ...registration("peer").session, project_key: "same" },
    })).session;
    const input = { session_id: sender.id, idempotency_key: "project-restart", message: { from: "", to: ["@project"], body: "original audience" } };
    const sent = Results["message.send"].parse(call("message.send", input));
    expect(sent.deliveries).toEqual({ [recipient.id]: "unread" });
    const deliveries = db.prepare("SELECT * FROM deliveries").all();
    call("session.gone", { session_id: recipient.id, incarnation: recipient.incarnation });
    reopen();
    const late = Results["session.upsert"].parse(call("session.upsert", {
      ...registration("late"), session: { ...registration("late").session, project_key: "same" },
    })).session;
    expect(call("message.send", input)).toEqual({ ...sent, replayed: true });
    expect(db.prepare("SELECT * FROM deliveries").all()).toEqual(deliveries);
    expect(() => call("inbox.list", { session_id: recipient.id })).toThrow(/session is gone/);
    expect(Results["message.read"].parse(call("message.read", { session_id: sender.id, id: sent.id })).message.to).toEqual(["@project"]);
    expect(Results["inbox.list"].parse(call("inbox.list", { session_id: late.id })).headers).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("enforces foreign keys on a reopened current-version database", () => {
    const session = register("author");
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    // Foreign-key enforcement is connection-local and must hold on the next open too.
    db.exec("PRAGMA foreign_keys = OFF");
    reopen();

    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("SELECT id FROM sessions").all()).toEqual([{ id: session.id }]);
    expect(() => db.prepare(`INSERT INTO session_registrations(reg_id, session_id, op, session_json)
      VALUES ('orphan-registration', 'missing-session', 'register', '{}')`).run())
      .toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare(`INSERT INTO board_versions(topic_id, key, version, body, author, author_session, op_id, created_at)
      SELECT id, 'orphan', 1, 'body', 'author@laptop', 'missing-session', 'orphan-board-op', ?
      FROM topics WHERE name = 'global'`).run(NOW))
      .toThrow(/FOREIGN KEY constraint failed/);
    expect(() => db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id))
      .toThrow(/FOREIGN KEY constraint failed/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("retains replay ownership, historical identities, wake decisions and sequences across restart", () => {
    const blocker = register("reviewer");
    const author = register("author");
    const reader = register("reader");
    const reincarnation = { op: "reincarnate", reg_id: "reincarnation-author", session: author };
    const reincarnated = Results["session.upsert"].parse(call("session.upsert", reincarnation));
    const send = {
      session_id: author.id, idempotency_key: "persistent-send-1",
      message: { from: author.handle, to: [reader.handle], body: "Before restart" },
    };
    const sent = Results["message.send"].parse(call("message.send", send));
    const put = { session_id: author.id, topic: "global", key: "decisions", body: "Keep the original author", op_id: "persistent-board-1" };
    const written = Results["board.put"].parse(call("board.put", put));
    const rename = { op: "update", session: { id: author.id, name: "reviewer" } };
    const renamed = Results["session.upsert"].parse(call("session.upsert", rename));
    expect(renamed.session.handle).toBe("reviewer-2@laptop");
    call("session.gone", { session_id: blocker.id, incarnation: blocker.incarnation });
    call("session.upsert", { op: "update", session: { id: reader.id, wake: "off" } });

    reopen();

    expect(call("session.upsert", registration("author"))).toEqual({ session: author, replayed: true });
    expect(call("session.upsert", reincarnation)).toEqual({ ...reincarnated, replayed: true });
    expect(call("session.upsert", rename)).toEqual({ ...renamed, replayed: true });
    expect(call("message.send", send)).toEqual({ ...sent, replayed: true });
    expect(call("board.put", put)).toEqual({ ...written, replayed: true });
    expect(events).toEqual([]);
    expect(db.prepare("SELECT handle, incarnation FROM sessions WHERE id = ?").get(author.id))
      .toEqual({ handle: "reviewer-2@laptop", incarnation: 1 });
    expect(db.prepare("SELECT next_seq FROM sessions WHERE id = ?").get(reader.id)).toEqual({ next_seq: 2 });
    const inbox = Results["inbox.list"].parse(call("inbox.list", { session_id: reader.id, unread_only: true, waking_only: true }));
    expect(inbox.headers).toMatchObject([{ id: sent.id, seq: 1, from: author.handle, wake: true, state: "unread" }]);
    expect(call("deliveries.resync", { acked: { [reader.id]: 0 } })).toEqual({ replayed: 1 });
    const delivery = z.object({ host: z.string(), notification: Notifications.deliver }).parse(events.at(-1)?.data);
    expect(delivery).toMatchObject({
      host: "laptop", notification: { session_id: reader.id, seq: 1, wake: false, message: { id: sent.id, from: author.handle } },
    });
    expect(call("deliveries.resync", { acked: { [reader.id]: 1 } })).toEqual({ replayed: 0 });
    expect(events).toHaveLength(1);

    const replacement = Results["session.upsert"].parse(call("session.upsert", {
      ...registration("author"), reg_id: "replacement-author",
    })).session;
    expect(replacement.handle).toBe(author.handle);
    expect(() => call("board.put", { ...put, session_id: replacement.id })).toThrow(/-32009/);
    expect(db.prepare("SELECT count(*) AS n FROM board_versions").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 1 });
    expect(reported).toEqual([]);
  });
});
