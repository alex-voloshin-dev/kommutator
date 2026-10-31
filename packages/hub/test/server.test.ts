import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import WebSocket from "ws";
import { MAX_FRAME_BYTES } from "@kommutator/protocol";
import { createHubServer, dispatch, isAuthorized } from "../src/server.js";
import { backupDatabase, IncompatibleDatabaseError, openDatabase, SCHEMA_VERSION } from "../src/db.js";

const KEY = "test-key-0123456789abcdef";
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function freshDb(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
}

describe("isAuthorized", () => {
  it("accepts Bearer and Basic with the key as password, rejects the rest", () => {
    expect(isAuthorized(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(isAuthorized(`Basic ${Buffer.from(`kom:${KEY}`).toString("base64")}`, KEY)).toBe(true);
    expect(isAuthorized(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(isAuthorized("Bearer ", KEY)).toBe(false);
    expect(isAuthorized(undefined, KEY)).toBe(false);
    expect(isAuthorized(`Bearer ${KEY}`, "")).toBe(false);
  });
});

describe("HTTP and WebSocket surface", () => {
  let server: Server;
  let base: string;
  let wsBase: string;
  const db = freshDb();
  const connectionErrors: string[] = [];

  beforeAll(async () => {
    db.prepare(`INSERT INTO hosts(name) VALUES ('laptop')`).run();
    db.prepare(
      `INSERT INTO sessions(id, host, handle, name, vendor, cwd, reg_id, started_at, last_seen_at)
       VALUES ('s1','laptop','author@laptop','author','claude-code','/private/project','reg-s1', datetime('now'), datetime('now'))`,
    ).run();
    server = createHubServer({ db, key: KEY, onConnectionError: (e) => connectionErrors.push(e.message) });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
  });
  afterAll(() => server.close());

  it("refuses the snapshot and the page without the key", async () => {
    const snap = await fetch(`${base}/api/snapshot`);
    expect(snap.status).toBe(401);
    expect(await snap.text()).not.toContain("/private/project");
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(401);
    expect(page.headers.get("www-authenticate")).toContain("Basic");
  });

  it("serves the snapshot with the key", async () => {
    const r = await fetch(`${base}/api/snapshot`, { headers: { authorization: `Bearer ${KEY}` } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { sessions: Array<{ handle: string }> };
    expect(body.sessions.map((s) => s.handle)).toEqual(["author@laptop"]);
  });

  it("refuses an unauthenticated WebSocket upgrade", async () => {
    const ws = new WebSocket(wsBase);
    const outcome = await new Promise<string>((res) => {
      ws.once("open", () => res("open"));
      ws.once("error", () => res("error"));
    });
    expect(outcome).toBe("error");
  });

  it("survives an oversize frame: only that connection dies, others keep working", async () => {
    const open = (): Promise<WebSocket> =>
      new Promise((res, rej) => {
        const ws = new WebSocket(wsBase, { headers: { authorization: `Bearer ${KEY}` } });
        ws.once("open", () => res(ws));
        ws.once("error", rej);
      });
    const a = await open();
    const b = await open();

    const aClosed = new Promise<number>((res) => a.once("close", (code) => res(code)));
    a.send("x".repeat(MAX_FRAME_BYTES + 1));
    expect(await aClosed).toBeGreaterThan(0); // server terminated A
    expect(connectionErrors.some((m) => /payload/i.test(m))).toBe(true);

    // The process is still here and B still gets answers.
    const reply = new Promise<string>((res) => b.once("message", (d) => res(d.toString())));
    b.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: {} }));
    const parsed = JSON.parse(await reply) as { id: number; error: { code: number } };
    expect(parsed.id).toBe(1);
    expect(parsed).toMatchObject({ result: { protocol_version: 1, sessions: 1 } });
    b.close();
  });

  it("survives malformed JSON-RPC envelopes from an authenticated client (T01)", async () => {
    const ws = await new Promise<WebSocket>((res, rej) => {
      const w = new WebSocket(wsBase, { headers: { authorization: `Bearer ${KEY}` } });
      w.once("open", () => res(w));
      w.once("error", rej);
    });
    const ask = (frame: string): Promise<{ id: unknown; error: { code: number } }> =>
      new Promise((res) => {
        ws.once("message", (d) => res(JSON.parse(d.toString())));
        ws.send(frame);
      });
    expect((await ask("null")).error.code).toBe(-32600);
    expect((await ask("42")).error.code).toBe(-32600);
    expect((await ask("[]")).error.code).toBe(-32600);
    expect((await ask('{"id":1,"method":{"x":1}}')).error.code).toBe(-32600);
    expect((await ask('{"id":1,"method":"status"')).error.code).toBe(-32700);
    // Still alive and still answering well-formed requests.
    const ok = await ask(JSON.stringify({ jsonrpc: "2.0", id: "req-7", method: "status" }));
    expect(ok.id).toBe("req-7");
    expect(ok).toMatchObject({ result: { protocol_version: 1, sessions: 1 } });
    ws.close();
  });
});

describe("dispatch", () => {
  it("never throws, whatever the input", () => {
    for (const raw of ["null", "true", "1", '"s"', "[]", "{}", '{"method":5}', '{"id":{},"method":"x"}', "", "\u0000"]) {
      expect(() => dispatch(raw)).not.toThrow();
    }
  });
  it("treats a request without id as a notification and stays silent", () => {
    expect(dispatch('{"method":"session.heartbeat","params":{}}')).toBeUndefined();
    expect(dispatch('{"id":null,"method":"x"}')).toBeUndefined();
  });
});

describe("schema invariants", () => {
  it("rejects two live sessions with the same handle, and a reused reg_id", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO hosts(name) VALUES ('laptop')`).run();
    const ins = db.prepare(
      `INSERT INTO sessions(id, host, handle, name, vendor, project_key, reg_id, started_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?, datetime('now'), datetime('now'))`,
    );
    ins.run("s1", "laptop", "reviewer@laptop", "reviewer", "codex", "p1", "reg-1");
    expect(() => ins.run("s2", "laptop", "reviewer@laptop", "reviewer", "codex", "p2", "reg-2")).toThrow(/UNIQUE/);
    db.prepare(`UPDATE sessions SET ended_at = datetime('now') WHERE id = 's1'`).run();
    ins.run("s3", "laptop", "reviewer@laptop", "reviewer", "codex", "p2", "reg-3"); // allowed once s1 ended
    // A replayed first registration (same reg_id) must hit the UNIQUE and be answered with the existing row, not a new session.
    expect(() => ins.run("s4", "laptop", "reviewer-2@laptop", "reviewer-2", "codex", "p2", "reg-3")).toThrow(/UNIQUE/);
  });

  it("rejects duplicate idempotency keys, duplicate (session, seq) and duplicate board op_id", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO hosts(name) VALUES ('h')`).run();
    db.prepare(
      `INSERT INTO sessions(id, host, handle, name, vendor, reg_id, started_at, last_seen_at)
       VALUES ('s1','h','a@h','a','codex','reg-a', datetime('now'), datetime('now'))`,
    ).run();
    const msg = db.prepare(
      `INSERT INTO messages(id, idempotency_key, from_session, kind, body, thread_id, created_at)
       VALUES (?, ?, 's1', 'dm', 'x', ?, datetime('now'))`,
    );
    msg.run("m1", "k1", "m1");
    expect(() => msg.run("m2", "k1", "m2")).toThrow(/UNIQUE/);
    msg.run("m2", "k2", "m2");
    const del = db.prepare(`INSERT INTO deliveries(message_id, session_id, seq, updated_at) VALUES (?, 's1', ?, datetime('now'))`);
    del.run("m1", 1);
    expect(() => del.run("m2", 1)).toThrow(/UNIQUE/);
    const ver = db.prepare(
      `INSERT INTO board_versions(topic_id, key, version, body, author, op_id, created_at) VALUES (1, 'k', ?, 'b', 'a@h', ?, datetime('now'))`,
    );
    ver.run(1, "op1");
    expect(() => ver.run(2, "op1")).toThrow(/UNIQUE/);
  });

  it("VACUUM INTO backup contains rows committed while the db is open in WAL mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "kom-"));
    const live = freshDb(join(dir, "live.db"));
    live.prepare(`INSERT INTO hosts(name) VALUES ('laptop')`).run();
    const target = join(dir, "backup.db");
    backupDatabase(live, target);
    const copy = new DatabaseSync(target);
    expect(copy.prepare(`SELECT count(*) AS n FROM hosts`).get()).toEqual({ n: 1 });
    copy.close();
    live.close();
  });
});

describe("openDatabase", () => {
  it("stamps a fresh database and reopens it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kom-"));
    const path = join(dir, "fresh.db");
    const db = openDatabase(path);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    db.close();
    const again = openDatabase(path);
    expect(again.prepare("SELECT count(*) AS n FROM topics").get()).toEqual({ n: 1 });
    again.close();
  });

  it("refuses a database created by an earlier schema instead of silently reusing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kom-"));
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    // The v0.2 shape: sessions without next_seq, messages without idempotency_key.
    old.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, host TEXT, handle TEXT);
              CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT);`);
    old.close();
    expect(() => openDatabase(path)).toThrow(IncompatibleDatabaseError);
    // ...and it must not have altered the old file on the way out.
    const check = new DatabaseSync(path);
    expect(check.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
    const cols = check.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).not.toContain("next_seq");
    check.close();
  });
});
