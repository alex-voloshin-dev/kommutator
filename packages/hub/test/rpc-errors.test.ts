import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "@kommutator/protocol";
import { errors, RpcFault, type HubPeer } from "../src/context.js";
import { HubEvents, type HubEvent } from "../src/events.js";
import { createHubRuntime, dispatch, type HubRuntime } from "../src/rpc.js";

const NOW = "2026-10-25T12:00:00.000Z";
const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function decoded(reply: string | undefined): unknown {
  if (reply === undefined) throw new Error("expected an RPC response");
  const value: unknown = JSON.parse(reply);
  return value;
}

function request(method: string, params: unknown = {}, id: string | number = "request-1"): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

describe("RPC notification and failure boundaries", () => {
  it.each([undefined, null])("executes a valid notification with id %s without replying", (id) => {
    const invoke = vi.fn(() => ({ ok: true }));
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method: "notify", params: { value: 7 } });

    expect(dispatch(frame, invoke)).toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("notify", { value: 7 });
  });

  it.each([undefined, null])("contains notification errors with id %s without replying", (id) => {
    const report = vi.fn();
    const fault = new RpcFault(errors.unauthorized, "caller denied");
    const failure = new Error("private database detail");
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method: "notify" });

    expect(dispatch(frame, () => { throw fault; }, report)).toBeUndefined();
    expect(report).not.toHaveBeenCalled();
    expect(dispatch(frame, () => { throw failure; }, report)).toBeUndefined();
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(dispatch(frame)).toBeUndefined();
  });

  it.each(["correlated-error", 0, -1])("preserves request id %s for known and internal errors", (id) => {
    const report = vi.fn();
    const frame = request("fail", {}, id);
    const failure = new Error("private database detail");

    expect(decoded(dispatch(frame, () => { throw new RpcFault(errors.conflict, "version conflict"); }, report)))
      .toEqual({ jsonrpc: "2.0", id, error: { code: errors.conflict, message: "version conflict" } });
    expect(report).not.toHaveBeenCalled();
    expect(decoded(dispatch(frame, () => { throw failure; }, report)))
      .toEqual({ jsonrpc: "2.0", id, error: { code: -32603, message: "internal error" } });
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(decoded(dispatch(frame, () => "recovered", report)))
      .toEqual({ jsonrpc: "2.0", id, result: "recovered" });
  });

  it("contains result serialization failures and retains the request id", () => {
    const report = vi.fn();
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(decoded(dispatch(request("circular", {}, "serialization-1"), () => circular, report)))
      .toEqual({ jsonrpc: "2.0", id: "serialization-1", error: { code: -32603, message: "internal error" } });
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(TypeError);
  });

  it("bounds serialized replies in UTF-8 and keeps the original correlation id", () => {
    const id = "response-limit";
    const overhead = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id, result: "" }));
    const available = MAX_FRAME_BYTES - overhead;
    const payload = "я".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
    const exact = dispatch(request("large", {}, id), () => payload)!;
    expect(Buffer.byteLength(exact)).toBe(MAX_FRAME_BYTES);
    expect(decoded(exact)).toMatchObject({ id, result: payload });
    const oversized = dispatch(request("large", {}, id), () => `${payload}x`)!;
    expect(Buffer.byteLength(oversized)).toBeLessThan(MAX_FRAME_BYTES);
    expect(decoded(oversized)).toMatchObject({ id, error: { code: -32011 } });
    expect(decoded(dispatch(request("escaped", {}, id), () => "\u0000".repeat(MAX_FRAME_BYTES / 2))))
      .toMatchObject({ id, error: { code: -32011 } });
  });

  it.each([
    "null", "true", "42", '"method"', "[]", '[{"id":1,"method":"status"}]', "{}",
    '{"id":1,"method":{}}', '{"id":1,"method":""}',
    '{"id":{},"method":"status"}', '{"id":true,"method":"status"}',
    '{"id":1.5,"method":"status"}', '{"jsonrpc":"1.0","id":1,"method":"status"}',
    JSON.stringify({ id: "x".repeat(129), method: "status" }),
    JSON.stringify({ id: 1, method: "x".repeat(129) }),
  ])("rejects invalid envelope %s before invoking a handler", (raw) => {
    const invoke = vi.fn();

    expect(decoded(dispatch(raw, invoke)))
      .toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(["", "\u0000", '{"id":1,"method":"status"', "[1,"])("rejects malformed JSON %s", (raw) => {
    const invoke = vi.fn();

    expect(decoded(dispatch(raw, invoke)))
      .toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts exactly 1 MiB of UTF-8 and rejects the next byte before handler execution", () => {
    const overhead = Buffer.byteLength(request("limit", "", "frame-limit"), "utf8");
    const available = MAX_FRAME_BYTES - overhead;
    const payload = "я".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
    const exact = request("limit", payload, "frame-limit");
    const oversized = request("limit", `${payload}x`, "frame-limit");
    const invoke = vi.fn(() => "accepted");

    expect(MAX_FRAME_BYTES).toBe(1024 * 1024);
    expect(Buffer.byteLength(exact, "utf8")).toBe(MAX_FRAME_BYTES);
    expect(exact.length).toBeLessThan(MAX_FRAME_BYTES);
    expect(decoded(dispatch(exact, invoke)))
      .toEqual({ jsonrpc: "2.0", id: "frame-limit", result: "accepted" });
    expect(invoke).toHaveBeenCalledOnce();
    expect(Buffer.byteLength(oversized, "utf8")).toBe(MAX_FRAME_BYTES + 1);
    expect(decoded(dispatch(oversized, invoke)))
      .toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "frame too large" } });
    expect(invoke).toHaveBeenCalledOnce();
  });
});

describe("runtime RPC errors and committed events", () => {
  let db: DatabaseSync;
  let runtime: HubRuntime;
  let reported: unknown[];

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(schema);
    reported = [];
    runtime = createHubRuntime({ db, now: () => NOW, onError: (error) => { reported.push(error); } });
  });
  afterEach(() => db.close());

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("rejects prototype-like method %s and keeps serving requests", (method) => {
    expect(decoded(runtime.dispatch(request(method, {}, "unknown-1"), {})))
      .toEqual({ jsonrpc: "2.0", id: "unknown-1", error: { code: -32601, message: "method not found" } });
    expect(decoded(runtime.dispatch(request("status", {}, 0), {})))
      .toEqual({ jsonrpc: "2.0", id: 0, result: { protocol_version: PROTOCOL_VERSION, hosts: 0, sessions: 0, messages: 0 } });
    expect(reported).toEqual([]);
  });

  it("preserves ids for parameter and caller-identity errors", () => {
    expect(decoded(runtime.dispatch(request("topic.list", {}, "params-1"), {})))
      .toEqual({ jsonrpc: "2.0", id: "params-1", error: { code: -32602, message: "invalid params" } });
    expect(decoded(runtime.dispatch(request("topic.list", { session_id: "session-1" }, "caller-1"), {})))
      .toEqual({ jsonrpc: "2.0", id: "caller-1", error: { code: errors.unauthorized, message: "hello required" } });
    expect(reported).toEqual([]);
  });

  it("executes a hello notification and persists its host binding without a reply", () => {
    const peer: HubPeer = {};
    const frame = JSON.stringify({
      jsonrpc: "2.0", method: "hello",
      params: { host: "laptop", agentd_version: "test", protocol_version: PROTOCOL_VERSION },
    });

    expect(runtime.dispatch(frame, peer)).toBeUndefined();
    expect(peer).toEqual({ host: "laptop" });
    expect(db.prepare("SELECT name, agentd_version, last_seen_at FROM hosts").all())
      .toEqual([{ name: "laptop", agentd_version: "test", last_seen_at: NOW }]);
  });

  it("keeps a heartbeat committed and notifies later listeners when an earlier listener throws", () => {
    db.prepare("INSERT INTO hosts(name) VALUES ('laptop')").run();
    db.prepare(`INSERT INTO sessions(id, host, handle, name, vendor, reg_id, started_at, last_seen_at)
      VALUES ('session-1', 'laptop', 'author@laptop', 'author', 'claude-code', 'reg-1', ?, ?)`)
      .run(NOW, NOW);
    const failure = new Error("subscriber unavailable");
    const observed: unknown[] = [];
    runtime.events.subscribe(() => { throw failure; });
    runtime.events.subscribe((event) => {
      // A second transaction can begin only after the handler's transaction committed.
      db.exec("BEGIN IMMEDIATE");
      try {
        observed.push({ event, row: db.prepare("SELECT state, last_seen_at FROM sessions WHERE id = 'session-1'").get() });
      } finally {
        db.exec("ROLLBACK");
      }
    });

    for (const [index, state] of ["idle", "active"].entries()) {
      expect(decoded(runtime.dispatch(request("session.heartbeat", { session_id: "session-1", state }, index), { host: "laptop" })))
        .toEqual({ jsonrpc: "2.0", id: index, result: { ok: true } });
    }

    expect(observed).toEqual(["idle", "active"].map((state, index) => ({
      event: { id: index + 1, type: "session.heartbeat", at: NOW, data: { session_id: "session-1", state } },
      row: { state, last_seen_at: NOW },
    })));
    expect(db.prepare("SELECT state FROM sessions WHERE id = 'session-1'").get()).toEqual({ state: "active" });
    expect(reported).toEqual([failure, failure]);
  });
});

describe("HubEvents subscriber isolation", () => {
  it("reports a failing listener, preserves delivery to other listeners, and supports unsubscribe", () => {
    const report = vi.fn();
    const events = new HubEvents(() => NOW, report);
    const failure = new Error("subscriber unavailable");
    const received: HubEvent[] = [];
    const unsubscribe = events.subscribe(() => { throw failure; });
    events.subscribe((event) => { received.push(event); });

    expect(() => events.publish("first", { value: 1 })).not.toThrow();
    unsubscribe();
    expect(() => events.publish("second", { value: 2 })).not.toThrow();

    expect(received).toEqual([
      { id: 1, type: "first", at: NOW, data: { value: 1 } },
      { id: 2, type: "second", at: NOW, data: { value: 2 } },
    ]);
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  });
});
