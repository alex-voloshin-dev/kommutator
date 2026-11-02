import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ident, LIMITS, MAX_FRAME_BYTES, Methods, PROTOCOL_VERSION, Results, Session } from "@kommutator/protocol";
import type { z } from "zod";
import { boardHistory, getBoard, putBoard } from "../src/board.js";
import { errors, type HubContext, type HubPeer } from "../src/context.js";
import { openDatabase } from "../src/db.js";
import { HubEvents, type HubEvent } from "../src/events.js";
import { goneSession, heartbeatSession, hello, listSessions, upsertSession } from "../src/sessions.js";
import { joinTopic, leaveTopic, listTopics } from "../src/topics.js";

let ctx: HubContext;
let peer: HubPeer;
let observed: HubEvent[];
let now: string;
let registration: number;

beforeEach(() => {
  let nextId = 0;
  registration = 0;
  now = "2026-10-25T12:00:00.000Z";
  observed = [];
  ctx = {
    db: openDatabase(":memory:"), now: () => now, newId: () => `session-${++nextId}`,
    events: new HubEvents(() => now),
  };
  ctx.events.subscribe((event) => observed.push(event));
  peer = {};
  hello(ctx, peer, { host: "laptop", agentd_version: "test", protocol_version: PROTOCOL_VERSION });
});

afterEach(() => {
  ctx.db.close();
  vi.restoreAllMocks();
});

function register(overrides: Partial<Omit<z.input<typeof Session>, "id" | "incarnation">> = {}, connection = peer) {
  return upsertSession(ctx, connection, Methods["session.upsert"].parse({
    op: "register",
    session: { host: connection.host, name: "author", vendor: "claude-code", project_key: "one", ...overrides },
    reg_id: `registration-${++registration}`,
  })).session;
}

function reincarnate(session: z.output<typeof Session> & { id: string }, regId: string) {
  return upsertSession(ctx, peer, Methods["session.upsert"].parse({ op: "reincarnate", session, reg_id: regId }));
}

function otherPeer(): HubPeer {
  const other: HubPeer = {};
  hello(ctx, other, { host: "server", agentd_version: "test", protocol_version: PROTOCOL_VERSION });
  return other;
}

describe("host and registration", () => {
  it("updates daemon-owned capability after hook facts arrive without changing identity or incarnation", () => {
    const session = register({ capability: "hook" });
    const params = Methods["session.upsert"].parse({ op: "update", session: { id: session.id, capability: "native" } });
    expect(upsertSession(ctx, peer, params)).toMatchObject({
      session: { id: session.id, handle: session.handle, incarnation: 0, capability: "native" }, replayed: false,
    });
    expect(upsertSession(ctx, peer, params).replayed).toBe(true);
    expect(() => upsertSession(ctx, otherPeer(), params)).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "update", session: { id: session.id, capability: "hook" },
    })).session.capability).toBe("hook");
  });

  it("binds hello once, upserts host metadata, and warns without refusing protocol mismatch", () => {
    now = "2026-10-25T12:01:00.000Z";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(hello(ctx, peer, { host: "laptop", agentd_version: "next", protocol_version: 99 }))
      .toEqual({ host: "laptop", protocol_version: PROTOCOL_VERSION });
    expect(warning).toHaveBeenCalledOnce();
    expect(ctx.db.prepare("SELECT * FROM hosts").all())
      .toEqual([{ name: "laptop", agentd_version: "next", last_seen_at: now }]);
    expect(() => hello(ctx, peer, { host: "server", agentd_version: "test", protocol_version: PROTOCOL_VERSION }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(peer.host).toBe("laptop");
  });

  it("assigns an identity, normalizes fields, and auto-joins global and the project", () => {
    const session = register({ name: " AUTHOR ", role: " REVIEWER " });
    expect(session).toEqual({
      id: "session-1", host: "laptop", name: "author", handle: "author@laptop", role: "reviewer",
      vendor: "claude-code", project_key: "one", state: "active", incarnation: 0, wake: "on", capability: "none",
    });
    expect(Session.safeParse(session).success).toBe(true);
    expect(listTopics(ctx, peer, { session_id: session.id })).toEqual({ topics: [
      { name: "global", kind: "global" }, { name: "project:one", kind: "project" },
    ] });
    expect(observed.map((event) => event.type)).toEqual(["session.registered"]);
  });

  it("replays the same registration after a lost reply without mutating identity or memberships", () => {
    const original = register();
    const replay = upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "register",
      session: { host: "laptop", name: "changed", vendor: "codex", project_key: "two" },
      reg_id: "registration-1",
    }));
    expect(replay.session).toEqual(original);
    expect(replay.replayed).toBe(true);
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    expect(listTopics(ctx, peer, { session_id: original.id }).topics.map((topic) => topic.name))
      .toEqual(["global", "project:one"]);
    expect(observed).toHaveLength(1);
  });

  it("requires hello and refuses host spoofing or another host's registration replay", () => {
    register();
    const params = Methods["session.upsert"].parse({
      op: "register",
      session: { host: "laptop", name: "other", vendor: "other" }, reg_id: "registration-1",
    });
    expect(() => upsertSession(ctx, {}, params)).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    const other = otherPeer();
    expect(() => upsertSession(ctx, other, params)).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(() => upsertSession(ctx, other, Methods["session.upsert"].parse({ ...params, session: { ...params.session, host: "server" } })))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
  });

  it("suffixes name collisions across projects and keeps 63-character names addressable", () => {
    expect(register().handle).toBe("author@laptop");
    expect(register({ project_key: "two" }).handle).toBe("author-2@laptop");
    expect(register().handle).toBe("author-3@laptop");
    const longName = "a".repeat(63);
    expect(register({ name: longName }).name).toBe(longName);
    for (let suffix = 2; suffix <= 12; suffix++) {
      const session = register({ name: longName });
      expect(session.name).toBe(`${longName.slice(0, 63 - String(suffix).length - 1)}-${suffix}`);
      expect(Ident.safeParse(session.name).success).toBe(true);
      expect(session.handle).toBe(`${session.name}@laptop`);
    }
  });

  it("reuses an ended handle while a replay still returns the original registration snapshot", () => {
    const ended = register();
    goneSession(ctx, peer, { session_id: ended.id, incarnation: ended.incarnation });
    const replacement = register();
    expect(replacement.handle).toBe(ended.handle);
    expect(replacement.id).not.toBe(ended.id);
    const replay = upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "register", session: { host: "laptop", name: "author", vendor: "claude-code" }, reg_id: "registration-1",
    })).session;
    expect(replay).toEqual(ended);
  });

  it("registers without a project and treats an initially gone session as ended", () => {
    const session = register({ project_key: undefined });
    expect(session).not.toHaveProperty("project_key");
    expect(listTopics(ctx, peer, { session_id: session.id })).toEqual({ topics: [{ name: "global", kind: "global" }] });
    const gone = register({ name: "finished", state: "gone" });
    expect(ctx.db.prepare("SELECT ended_at FROM sessions WHERE id = ?").get(gone.id)).toEqual({ ended_at: now });
    expect(register({ name: "finished" }).handle).toBe(gone.handle);
  });

  it("rejects an overlong derived project topic without leaving partial registration", () => {
    const atLimit = register({ project_key: "a".repeat(112) });
    expect(listTopics(ctx, peer, { session_id: atLimit.id }).topics[1]?.name).toHaveLength(120);
    expect(() => register({ project_key: "b".repeat(113) }))
      .toThrowError(expect.objectContaining({ code: errors.invalidParams }));
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    expect(observed).toHaveLength(1);
  });

  it("rolls back session and project creation together when auto-join fails", () => {
    ctx.db.exec(`CREATE TRIGGER fail_membership BEFORE INSERT ON memberships
      WHEN NEW.topic_id != 1 BEGIN SELECT RAISE(ABORT, 'membership failed'); END`);
    expect(() => register()).toThrow("membership failed");
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(ctx.db.prepare("SELECT name FROM topics").all()).toEqual([{ name: "global" }]);
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM session_registrations").get()).toEqual({ count: 0 });
    expect(observed).toHaveLength(0);
  });
});

describe("session updates and reincarnation", () => {
  it("updates only provided fields, leaves incarnation untouched, and makes identical updates no-ops", () => {
    const original = register({ role: "writer", status_line: "Before", state: "idle" });
    const params = { op: "update" as const, session: { id: original.id, role: "reviewer", status_line: "After", wake: "off" as const } };
    const updated = upsertSession(ctx, peer, params);
    expect(updated).toEqual({ session: { ...original, role: "reviewer", status_line: "After", wake: "off" }, replayed: false });
    expect(upsertSession(ctx, peer, params)).toEqual({ ...updated, replayed: true });
    expect(upsertSession(ctx, peer, { op: "update", session: { id: original.id } })).toEqual({ ...updated, replayed: true });
    expect(observed.map((event) => event.type)).toEqual(["session.registered", "session.updated"]);
    expect(Methods["session.upsert"].safeParse({ ...params, session: { ...params.session, project_key: "other" } }).success).toBe(false);
  });

  it("keeps a resolved rename stable on replay even after its requested base name becomes available", () => {
    const owner = register({ name: "reviewer" });
    const author = register();
    const params = { op: "update" as const, session: { id: author.id, name: "reviewer" } };
    const updated = upsertSession(ctx, peer, params);
    expect(updated.session.handle).toBe("reviewer-2@laptop");
    expect(upsertSession(ctx, peer, params)).toEqual({ ...updated, replayed: true });
    goneSession(ctx, peer, { session_id: owner.id, incarnation: 0 });
    expect(upsertSession(ctx, peer, params)).toEqual({ ...updated, replayed: true });
    expect(listSessions(ctx, peer, { session_id: author.id }).sessions.find((session) => session.id === author.id)?.handle)
      .toBe("reviewer-2@laptop");
  });

  it("keeps a renamed maximum-length handle valid and its repeated update stable", () => {
    const requested = "a".repeat(63);
    register({ name: requested });
    const author = register();
    const params = { op: "update" as const, session: { id: author.id, name: requested } };
    const updated = upsertSession(ctx, peer, params);
    expect(updated.session.name).toBe(`${"a".repeat(61)}-2`);
    expect(upsertSession(ctx, peer, params)).toEqual({ ...updated, replayed: true });
  });

  it("reincarnates once, restores active state, preserves memberships and ignores incoming identity fields", () => {
    const original = register({ role: "writer", wake: "off", vendor_session_id: "vendor-original", cwd: "/one" });
    joinTopic(ctx, peer, { session_id: original.id, name: "team" });
    ctx.db.prepare("UPDATE sessions SET next_seq = 9 WHERE id = ?").run(original.id);
    goneSession(ctx, peer, { session_id: original.id, incarnation: 0 });
    now = "2026-10-25T13:00:00.000Z";
    const params = { ...original, name: "intruder", project_key: "other", role: "admin", vendor: "other" as const,
      vendor_session_id: "vendor-other", cwd: "/other", wake: "on" as const, state: "gone" as const, incarnation: 99 };
    const revived = reincarnate(params, "incarnation-1");
    expect(revived).toEqual({ session: { ...original, incarnation: 1 }, replayed: false });
    expect(reincarnate(params, "incarnation-1")).toEqual({ ...revived, replayed: true });
    expect(ctx.db.prepare("SELECT next_seq, ended_at, last_seen_at FROM sessions WHERE id = ?").get(original.id))
      .toEqual({ next_seq: 9, ended_at: null, last_seen_at: now });
    expect(listTopics(ctx, peer, { session_id: original.id }).topics.map((topic) => topic.name))
      .toEqual(["global", "project:one", "team"]);
    expect(() => getBoard(ctx, peer, { session_id: original.id, topic: "project:other" }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(observed.filter((event) => event.type === "session.registered")).toHaveLength(2);
  });

  it("recovers a gone session with a suffix when its former handle has been claimed", () => {
    register();
    const original = register();
    expect(original.name).toBe("author-2");
    goneSession(ctx, peer, { session_id: original.id, incarnation: 0 });
    expect(register().name).toBe("author-2");
    const revived = reincarnate(original, "incarnation-1");
    expect(revived.session).toMatchObject({ id: original.id, handle: "author-3@laptop", incarnation: 1 });
    expect(reincarnate(original, "incarnation-1")).toEqual({ ...revived, replayed: true });
  });

  it("returns historical registration snapshots without rolling the current incarnation back", () => {
    const original = register();
    const renamed = upsertSession(ctx, peer, { op: "update", session: { id: original.id, name: "renamed" } }).session;
    const first = reincarnate(renamed, "incarnation-1");
    const second = reincarnate(first.session, "incarnation-2");
    const countBeforeReplay = observed.length;
    expect(upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "register", session: { host: "laptop", name: "author", vendor: "claude-code" }, reg_id: "registration-1",
    }))).toEqual({ session: original, replayed: true });
    expect(reincarnate(original, "incarnation-1")).toEqual({ ...first, replayed: true });
    expect(listSessions(ctx, peer, { session_id: original.id }).sessions).toEqual([second.session]);
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM session_registrations").get()).toEqual({ count: 3 });
    expect(observed).toHaveLength(countBeforeReplay);
  });

  it("refuses operation-key reuse across operations, sessions and hosts", () => {
    const original = register();
    const other = register({ name: "other" });
    reincarnate(original, "incarnation-1");
    expect(() => reincarnate(original, "registration-1")).toThrowError(expect.objectContaining({ code: errors.conflict }));
    expect(() => reincarnate(other, "incarnation-1")).toThrowError(expect.objectContaining({ code: errors.conflict }));
    expect(() => upsertSession(ctx, peer, Methods["session.upsert"].parse({
      op: "register", session: { host: "laptop", name: "other", vendor: "other" }, reg_id: "incarnation-1",
    }))).toThrowError(expect.objectContaining({ code: errors.conflict }));
    const remote = otherPeer();
    expect(() => upsertSession(ctx, remote, { op: "update", session: { id: original.id, wake: "off" } }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(() => upsertSession(ctx, remote, { op: "reincarnate", session: { ...original, host: "server" }, reg_id: "incarnation-1" }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(listSessions(ctx, peer, { session_id: original.id }).sessions.find((session) => session.id === original.id)?.incarnation).toBe(1);
  });

  it("rolls back reincarnation when recording its registration snapshot fails", () => {
    const original = register();
    goneSession(ctx, peer, { session_id: original.id, incarnation: 0 });
    ctx.db.exec(`CREATE TRIGGER fail_registration BEFORE INSERT ON session_registrations
      BEGIN SELECT RAISE(ABORT, 'registration failed'); END`);
    expect(() => reincarnate(original, "incarnation-1")).toThrow("registration failed");
    expect(ctx.db.prepare("SELECT incarnation, state, reg_id, ended_at FROM sessions WHERE id = ?").get(original.id))
      .toEqual({ incarnation: 0, state: "gone", reg_id: "registration-1", ended_at: now });
    expect(observed.map((event) => event.type)).toEqual(["session.registered", "session.gone"]);
  });
});

describe("session presence and visibility", () => {
  it("heartbeats live sessions, ignores stale gone, and ends the current incarnation idempotently", () => {
    const session = reincarnate(register(), "incarnation-1").session;
    now = "2026-10-25T12:02:00.000Z";
    expect(() => heartbeatSession(ctx, peer, { session_id: session.id, state: "gone" }))
      .toThrowError(expect.objectContaining({ code: errors.invalidParams }));
    expect(heartbeatSession(ctx, peer, { session_id: session.id, state: "idle" })).toEqual({ ok: true });
    goneSession(ctx, peer, { session_id: session.id, incarnation: 0 });
    expect(ctx.db.prepare("SELECT state, last_seen_at, ended_at FROM sessions WHERE id = ?").get(session.id))
      .toEqual({ state: "idle", last_seen_at: now, ended_at: null });
    expect(() => goneSession(ctx, peer, { session_id: session.id, incarnation: 2 }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    goneSession(ctx, peer, { session_id: session.id, incarnation: 1 });
    const endedAt = now;
    now = "2026-10-25T12:03:00.000Z";
    goneSession(ctx, peer, { session_id: session.id, incarnation: 1 });
    expect(ctx.db.prepare("SELECT state, ended_at FROM sessions WHERE id = ?").get(session.id))
      .toEqual({ state: "gone", ended_at: endedAt });
    expect(() => heartbeatSession(ctx, peer, { session_id: session.id, state: "active" }))
      .toThrowError(expect.objectContaining({ code: errors.notFound }));
    expect(observed.map((event) => event.type)).toEqual(["session.registered", "session.registered", "session.heartbeat", "session.gone"]);
  });

  it("lists shared-topic sessions with role, state and authorized topic filters", () => {
    const author = register({ role: "writer" });
    const reviewer = register({ name: "reviewer", role: "reviewer", state: "idle" });
    const outsider = register({ name: "outsider", project_key: "two" });
    expect(listSessions(ctx, peer, { session_id: author.id }).sessions.map((session) => session.id))
      .toEqual([author.id, outsider.id, reviewer.id]);
    expect(listSessions(ctx, peer, { session_id: author.id, topic: "project:one" }).sessions)
      .toEqual([author, reviewer]);
    expect(listSessions(ctx, peer, { session_id: author.id, role: "reviewer", state: "idle" }).sessions)
      .toEqual([reviewer]);
    expect(() => listSessions(ctx, peer, { session_id: author.id, topic: "project:two" }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    ctx.db.prepare("DELETE FROM memberships WHERE session_id = ?").run(outsider.id);
    expect(listSessions(ctx, peer, { session_id: author.id }).sessions).toEqual([author, reviewer]);
  });

  it("excludes gone sessions by default and keeps explicit history under membership checks", () => {
    const author = register();
    const ended = register({ name: "ended", role: "reviewer" });
    const unknown = register({ name: "unknown", state: "unknown" });
    const idle = register({ name: "idle", state: "idle" });
    goneSession(ctx, peer, { session_id: ended.id, incarnation: ended.incarnation });
    expect(listSessions(ctx, peer, { session_id: author.id }).sessions).toEqual([author, idle, unknown]);
    expect(listSessions(ctx, peer, { session_id: author.id, state: "gone", role: "reviewer" }).sessions).toEqual([{ ...ended, state: "gone" }]);
    expect(() => listSessions(ctx, peer, { session_id: author.id, state: "gone", topic: "project:private" })).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    ctx.db.prepare("DELETE FROM memberships WHERE session_id = ?").run(ended.id);
    expect(listSessions(ctx, peer, { session_id: author.id, state: "gone" }).sessions).toEqual([]);
  });

  it("refuses all scoped calls made through a different host", () => {
    const session = register();
    const other = otherPeer();
    const actions = [
      () => heartbeatSession(ctx, other, { session_id: session.id, state: "idle" }),
      () => goneSession(ctx, other, { session_id: session.id, incarnation: 0 }),
      () => listSessions(ctx, other, { session_id: session.id }),
      () => joinTopic(ctx, other, { session_id: session.id, name: "chat" }),
      () => leaveTopic(ctx, other, { session_id: session.id, name: "chat" }),
      () => listTopics(ctx, other, { session_id: session.id }),
      () => getBoard(ctx, other, { session_id: session.id, topic: "global" }),
      () => boardHistory(ctx, other, Methods["board.history"].parse({ session_id: session.id, topic: "global", key: "key" })),
      () => putBoard(ctx, other, { session_id: session.id, topic: "global", key: "key", body: "x", op_id: "operation-1" }),
    ];
    for (const action of actions) expect(action).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
  });
});

describe("topic membership", () => {
  it("rejects whitespace on creation while retaining legacy archive access", () => {
    const session = register();
    for (const name of ["release planning", "release\tplanning", "release\nplanning", "release\u00a0planning", "release\u0085planning"]) {
      expect(() => joinTopic(ctx, peer, { session_id: session.id, name }))
        .toThrowError(expect.objectContaining({ code: errors.invalidParams }));
      expect(ctx.db.prepare("SELECT id FROM topics WHERE name=?").get(name)).toBeUndefined();
    }
    ctx.db.prepare("INSERT INTO topics(name, kind) VALUES (?, 'adhoc')").run("legacy archive");
    expect(joinTopic(ctx, peer, { session_id: session.id, name: "legacy archive" })).toEqual({ ok: true, created: false, joined: true });
    expect(getBoard(ctx, peer, { session_id: session.id, topic: "legacy archive" })).toEqual({ entries: [] });
    expect(leaveTopic(ctx, peer, { session_id: session.id, name: "legacy archive" })).toEqual({ ok: true });
    expect(joinTopic(ctx, peer, { session_id: session.id, name: "new-feedback" })).toEqual({ ok: true, created: true, joined: true });
  });

  it("joins and leaves an ad-hoc topic idempotently", () => {
    const session = register();
    const params = { session_id: session.id, name: "release-planning" };
    expect(Results["topic.join"].parse(joinTopic(ctx, peer, params))).toEqual({ ok: true, created: true, joined: true });
    expect(joinTopic(ctx, peer, params)).toEqual({ ok: true, created: false, joined: false });
    expect(listTopics(ctx, peer, { session_id: session.id }).topics)
      .toContainEqual({ name: params.name, kind: "adhoc" });
    expect(getBoard(ctx, peer, { session_id: session.id, topic: params.name })).toEqual({ entries: [] });
    expect(leaveTopic(ctx, peer, params)).toEqual({ ok: true });
    leaveTopic(ctx, peer, params);
    expect(() => getBoard(ctx, peer, { session_id: session.id, topic: params.name }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(observed.map((event) => event.type)).toEqual(["session.registered", "topic.join", "topic.leave"]);
  });

  it("discovers only ad-hoc names without joining or revealing other projects and boards", () => {
    const author = register();
    const outsider = register({ name: "outsider", project_key: "private-project" });
    joinTopic(ctx, peer, { session_id: outsider.id, name: "shared-planning" });
    putBoard(ctx, peer, { session_id: outsider.id, topic: "shared-planning", key: "private", body: "secret board", op_id: "private-board-op" });
    const joined = listTopics(ctx, peer, { session_id: author.id });
    expect(joined.topics).not.toContainEqual({ name: "shared-planning", kind: "adhoc" });
    expect(listTopics(ctx, peer, { session_id: author.id, discover: false })).toEqual(joined);
    const discovered = Results["topic.list"].parse(listTopics(ctx, peer, { session_id: author.id, discover: true }));
    expect(discovered.topics).toEqual([
      { name: "global", kind: "global" }, { name: "project:one", kind: "project" },
      { name: "shared-planning", kind: "adhoc" },
    ]);
    expect(listTopics(ctx, peer, { session_id: author.id })).toEqual(joined);
    expect(() => getBoard(ctx, peer, { session_id: author.id, topic: "shared-planning" })).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(() => listTopics(ctx, otherPeer(), { session_id: author.id, discover: true })).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(joinTopic(ctx, peer, { session_id: author.id, name: "shared-planning" })).toEqual({ ok: true, created: false, joined: true });
    expect(listTopics(ctx, peer, { session_id: author.id, discover: true })).toEqual(discovered);
    expect(getBoard(ctx, peer, { session_id: author.id, topic: "shared-planning" }).entries[0]?.body).toBe("secret board");
  });

  it("refuses joins and leaves for implicit topics and keeps the other project's board private", () => {
    const session = register();
    register({ project_key: "two" });
    for (const name of ["global", "project:one", "project:two"]) {
      expect(() => joinTopic(ctx, peer, { session_id: session.id, name }))
        .toThrowError(expect.objectContaining({ code: errors.invalidParams }));
      expect(() => leaveTopic(ctx, peer, { session_id: session.id, name }))
        .toThrowError(expect.objectContaining({ code: errors.invalidParams }));
    }
    expect(() => getBoard(ctx, peer, { session_id: session.id, topic: "project:two" }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(listTopics(ctx, peer, { session_id: session.id }).topics.map((topic) => topic.name))
      .toEqual(["global", "project:one"]);
  });
});

describe("versioned boards", () => {
  it("creates entries with derived authorship and isolates get, put and history by membership", () => {
    const author = register();
    const outsider = register({ name: "outsider", project_key: "two" });
    const entry = putBoard(ctx, peer, {
      session_id: author.id, topic: "project:one", key: "decisions", body: "Use SQLite", op_id: "operation-1",
    });
    expect(Results["board.put"].safeParse(entry).success).toBe(true);
    expect(entry).toEqual({ replayed: false, entry: {
      topic: "project:one", key: "decisions", body: "Use SQLite", version: 1,
      author: author.handle, protected: false, updated_at: now,
    } });
    expect(getBoard(ctx, peer, { session_id: author.id, topic: "project:one" })).toEqual({ entries: [entry.entry] });
    expect(getBoard(ctx, peer, { session_id: author.id, topic: "project:one", key: "absent" })).toEqual({ entries: [] });
    for (const action of [
      () => getBoard(ctx, peer, { session_id: outsider.id, topic: "project:one" }),
      () => boardHistory(ctx, peer, Methods["board.history"].parse({ session_id: outsider.id, topic: "project:one", key: "decisions" })),
      () => putBoard(ctx, peer, { session_id: outsider.id, topic: "project:one", key: "decisions", body: "x", op_id: "operation-2" }),
    ]) expect(action).toThrowError(expect.objectContaining({ code: errors.unauthorized }));
  });

  it("requires CAS for existing keys and rejects a version condition for a missing key", () => {
    const session = register();
    const params = { session_id: session.id, topic: "global", key: "decisions", body: "first", op_id: "operation-1" };
    expect(() => putBoard(ctx, peer, { ...params, if_version: 1 }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    putBoard(ctx, peer, params);
    expect(() => putBoard(ctx, peer, { ...params, body: "missing CAS", op_id: "operation-2" }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    expect(() => putBoard(ctx, peer, { ...params, if_version: 2, op_id: "operation-2" }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    putBoard(ctx, peer, { ...params, body: "winner", if_version: 1, op_id: "operation-2" });
    expect(() => putBoard(ctx, peer, { ...params, body: "loser", if_version: 1, op_id: "operation-3" }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    expect(boardHistory(ctx, peer, Methods["board.history"].parse(params)).entries.map((entry) => entry.body)).toEqual(["winner", "first"]);
  });

  it("preserves protection unless specified and replays the original version after newer writes", () => {
    const session = register();
    const params = { session_id: session.id, topic: "global", key: "decisions", body: "first", op_id: "operation-1" };
    const first = putBoard(ctx, peer, { ...params, protected: true });
    now = "2026-10-25T12:03:00.000Z";
    const second = putBoard(ctx, peer, { ...params, body: "second", if_version: 1, op_id: "operation-2" });
    expect(second.entry.protected).toBe(true);
    const third = putBoard(ctx, peer, { ...params, body: "third", if_version: 2, protected: false, op_id: "operation-3" });
    expect(third.entry.protected).toBe(false);
    expect(putBoard(ctx, peer, { ...params, body: "different retry payload", if_version: 99 }))
      .toEqual({ entry: first.entry, replayed: true });
    expect(boardHistory(ctx, peer, Methods["board.history"].parse(params))).toEqual({
      entries: [third.entry, second.entry, first.entry], more: false, next_before_version: null,
    });
    expect(getBoard(ctx, peer, params).entries).toEqual([third.entry]);
    expect(observed.filter((event) => event.type === "board.put")).toHaveLength(3);
  });

  it("checks membership and replay topic, key and author before returning a stored operation", () => {
    const author = register();
    const other = register({ name: "other" });
    const params = { session_id: author.id, topic: "global", key: "secret", body: "original", op_id: "operation-1" };
    putBoard(ctx, peer, params);
    for (const altered of [
      { ...params, key: "different" }, { ...params, topic: "project:one" }, { ...params, session_id: other.id },
    ]) expect(() => putBoard(ctx, peer, altered)).toThrowError(expect.objectContaining({ code: errors.conflict }));
    joinTopic(ctx, peer, { session_id: author.id, name: "private" });
    putBoard(ctx, peer, { ...params, topic: "private", op_id: "operation-2" });
    leaveTopic(ctx, peer, { session_id: author.id, name: "private" });
    expect(() => putBoard(ctx, peer, { ...params, topic: "private", op_id: "operation-2" }))
      .toThrowError(expect.objectContaining({ code: errors.unauthorized }));
    expect(ctx.db.prepare("SELECT COUNT(*) AS count FROM board_versions").get()).toEqual({ count: 2 });
  });

  it("replays an author's operation after rename but refuses a session reusing that author's old handle", () => {
    const author = register();
    const params = { session_id: author.id, topic: "global", key: "decisions", body: "original", op_id: "operation-1" };
    const first = putBoard(ctx, peer, params);
    upsertSession(ctx, peer, { op: "update", session: { id: author.id, name: "renamed" } });
    const replacement = register();
    expect(replacement.handle).toBe(author.handle);
    expect(putBoard(ctx, peer, params)).toEqual({ entry: first.entry, replayed: true });
    expect(first.entry.author).toBe("author@laptop");
    expect(() => putBoard(ctx, peer, { ...params, session_id: replacement.id }))
      .toThrowError(expect.objectContaining({ code: errors.conflict }));
    const second = putBoard(ctx, peer, { ...params, body: "second", if_version: 1, op_id: "operation-2" });
    expect(second.entry.author).toBe("renamed@laptop");
    expect(ctx.db.prepare("SELECT DISTINCT author_session FROM board_versions").all()).toEqual([{ author_session: author.id }]);
  });

  it("refuses replay when a historical row has no recorded session owner", () => {
    const author = register();
    const params = { session_id: author.id, topic: "global", key: "decisions", body: "original", op_id: "operation-1" };
    putBoard(ctx, peer, params);
    ctx.db.prepare("UPDATE board_versions SET author_session = NULL WHERE op_id = ?").run(params.op_id);
    expect(() => putBoard(ctx, peer, params)).toThrowError(expect.objectContaining({ code: errors.conflict }));
  });

  it("pages through 65 maximum-size versions without missing or duplicate entries and stays within the frame limit", () => {
    const author = register();
    const params = { session_id: author.id, topic: "global", key: "decisions" };
    const body = "\u0000".repeat(LIMITS.boardBody);
    for (let version = 1; version <= 65; version++) {
      putBoard(ctx, peer, {
        ...params, body, op_id: `history-operation-${version}`,
        ...(version === 1 ? {} : { if_version: version - 1 }),
      });
    }
    const versions: number[] = [];
    const pageSizes: number[] = [];
    let beforeVersion: number | undefined;
    do {
      const page = boardHistory(ctx, peer, Methods["board.history"].parse({ ...params, before_version: beforeVersion }));
      expect(Results["board.history"].safeParse(page).success).toBe(true);
      expect(page.entries.length).toBeLessThanOrEqual(10);
      expect(page.entries.every((entry) => entry.body === body)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: "history", result: page }))).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      versions.push(...page.entries.map((entry) => entry.version));
      pageSizes.push(page.entries.length);
      if (page.more) {
        expect(page.next_before_version).toBe(page.entries.at(-1)?.version);
        beforeVersion = page.next_before_version ?? undefined;
      } else {
        expect(page.next_before_version).toBeNull();
        beforeVersion = undefined;
      }
    } while (beforeVersion !== undefined);
    expect(pageSizes).toEqual([10, 10, 10, 10, 10, 10, 5]);
    expect(versions).toEqual(Array.from({ length: 65 }, (_, index) => 65 - index));
    expect(boardHistory(ctx, peer, Methods["board.history"].parse({ ...params, before_version: 1 })))
      .toEqual({ entries: [], more: false, next_before_version: null });
    expect(Methods["board.history"].safeParse({ ...params, limit: 11 }).success).toBe(false);
  });

  it("honors smaller pages and an exclusive version cursor", () => {
    const author = register();
    const params = { session_id: author.id, topic: "global", key: "decisions" };
    for (let version = 1; version <= 3; version++) {
      putBoard(ctx, peer, { ...params, body: `version ${version}`, op_id: `history-operation-${version}`,
        ...(version === 1 ? {} : { if_version: version - 1 }) });
    }
    const page = boardHistory(ctx, peer, Methods["board.history"].parse({ ...params, before_version: 3, limit: 1 }));
    expect(page.entries.map((entry) => entry.version)).toEqual([2]);
    expect(page).toMatchObject({ more: true, next_before_version: 2 });
    const last = boardHistory(ctx, peer, Methods["board.history"].parse({ ...params, before_version: 2, limit: 1 }));
    expect(last.entries.map((entry) => entry.version)).toEqual([1]);
    expect(last).toMatchObject({ more: false, next_before_version: null });
  });

  it("rolls back the current entry if recording its history fails and emits only after commit", () => {
    const session = register();
    const params = { session_id: session.id, topic: "global", key: "decisions", body: "first", op_id: "operation-1" };
    const original = putBoard(ctx, peer, params).entry;
    ctx.db.exec(`CREATE TRIGGER fail_history BEFORE INSERT ON board_versions
      BEGIN SELECT RAISE(ABORT, 'history failed'); END`);
    expect(() => putBoard(ctx, peer, { ...params, body: "second", if_version: 1, op_id: "operation-2" }))
      .toThrow("history failed");
    expect(getBoard(ctx, peer, params).entries).toEqual([original]);
    expect(boardHistory(ctx, peer, Methods["board.history"].parse(params)).entries).toEqual([original]);
    expect(observed.filter((event) => event.type === "board.put")).toHaveLength(1);
    ctx.db.exec("DROP TRIGGER fail_history");
    let versionAtEvent = 0;
    ctx.events.subscribe((event) => {
      if (event.type === "board.put") {
        ctx.db.exec("BEGIN IMMEDIATE");
        versionAtEvent = getBoard(ctx, peer, params).entries[0]?.version ?? 0;
        ctx.db.exec("COMMIT");
      }
    });
    putBoard(ctx, peer, { ...params, body: "second", if_version: 1, op_id: "operation-2" });
    expect(versionAtEvent).toBe(2);
  });
});
