import { afterEach, describe, expect, it } from "vitest";
import { Results } from "@kommutator/protocol";
import { createConformanceHarness, RemoteRpcError } from "../src/testing.js";

const open: Array<ReturnType<typeof createConformanceHarness>> = [];
afterEach(() => { for (const harness of open.splice(0)) harness.close(); });

function harness() {
  let id = 0;
  const value = createConformanceHarness({ now: () => "2026-10-25T16:00:00.000Z", newId: () => `fixture-${++id}` });
  open.push(value);
  return value;
}

describe("protocol conformance through the production dispatcher", () => {
  it("registers, sends, delivers, lists, reads and acknowledges without sockets", () => {
    const hub = harness();
    const a = hub.connect("laptop");
    const b = hub.connect("server");
    const sender = Results["session.upsert"].parse(a.request("session.upsert", {
      op: "register", reg_id: "register-author", session: { host: "laptop", name: "author", vendor: "claude-code", project_key: "demo" },
    })).session;
    const receiver = Results["session.upsert"].parse(b.request("session.upsert", {
      op: "register", reg_id: "register-reviewer", session: { host: "server", name: "reviewer", vendor: "claude-code", project_key: "demo" },
    })).session;
    const author = a.bindSession(sender.id);
    const reviewer = b.bindSession(receiver.id);
    const sendParams = {
      idempotency_key: "message-lost-ack",
      message: { from: "forged@host", to: [receiver.handle], body: "Please review\nDetails", kind: "request" },
    };
    const sent = Results["message.send"].parse(author.request("message.send", sendParams));
    expect(sent).toMatchObject({ deliveries: { [receiver.id]: "unread" }, replayed: false });
    expect(a.deliveries).toEqual([]);
    expect(b.deliveries).toMatchObject([{ session_id: receiver.id, seq: 1, wake: true,
      message: { id: sent.id, from: sender.handle, thread_id: sent.id } }]);

    // Replay after a lost ACK uses the same message and does not notify twice.
    expect(Results["message.send"].parse(author.request("message.send", sendParams))).toEqual({ ...sent, replayed: true });
    expect(b.deliveries).toHaveLength(1);
    const inbox = Results["inbox.list"].parse(reviewer.request("inbox.list", { unread_only: true, since_seq: 999 }));
    expect(inbox.headers).toMatchObject([{ id: sent.id, preview: "Please review", state: "unread", seq: 1 }]);
    expect(Results["message.read"].parse(reviewer.request("message.read", { id: sent.id })))
      .toMatchObject({ message: { body: "Please review\nDetails" }, state: "read" });
    expect(Results["receipt.mark"].parse(reviewer.request("receipt.mark", { ids: [sent.id], state: "read" }))).toEqual({ ok: true });
    expect(Results["inbox.list"].parse(reviewer.request("inbox.list", { unread_only: true })).headers).toEqual([]);
  });

  it("validates calls and stamps the fixture-bound session instead of a supplied session_id", () => {
    const hub = harness();
    const a = hub.connect("laptop");
    const b = hub.connect("server");
    const register = (client: typeof a, host: string, name: string) => Results["session.upsert"].parse(client.request("session.upsert", {
      op: "register", reg_id: `register-${name}`, session: { host, name, vendor: "other" },
    })).session;
    const alice = register(a, "laptop", "alice");
    const bob = register(b, "server", "bob");
    expect(() => a.request("inbox.list", { session_id: bob.id })).toThrow(RemoteRpcError);
    expect(a.bindSession(alice.id).request("inbox.list", { session_id: bob.id })).toMatchObject({ headers: [] });
    expect(() => a.request("receipt.mark", { session_id: alice.id, ids: [], state: "read" })).toThrow("invalid params");
    expect(() => a.request("ipc.hello", {})).toThrow("method not found");
    expect(() => a.request("constructor", {})).toThrow("method not found");
  });

  it("updates and reincarnates one identity, retaining every registration replay", () => {
    const hub = harness();
    const client = hub.connect(" LAPTOP ");
    const session = Results["session.upsert"].parse(client.request("session.upsert", {
      op: "register", reg_id: "register-original", session: { host: "laptop", name: "author", vendor: "other" },
    })).session;
    expect(client.request("session.upsert", { op: "update", session: { id: session.id, name: "reviewer" } }))
      .toMatchObject({ session: { handle: "reviewer@laptop", incarnation: 0 }, replayed: false });
    const reincarnate = { op: "reincarnate", reg_id: "register-new-life", session };
    expect(client.request("session.upsert", reincarnate)).toMatchObject({ session: { id: session.id, incarnation: 1 }, replayed: false });
    expect(client.request("session.upsert", reincarnate)).toMatchObject({ session: { id: session.id, incarnation: 1 }, replayed: true });
    expect(client.request("session.upsert", {
      op: "register", reg_id: "register-original", session: { host: "laptop", name: "author", vendor: "other" },
    })).toEqual({ session, replayed: true });
    expect(client.request("status")).toMatchObject({ sessions: 1 });
  });

  it("replaces a host connection and replays committed unread deliveries without duplicates", () => {
    const hub = harness();
    const client = hub.connect(" LAPTOP ");
    const session = Results["session.upsert"].parse(client.request("session.upsert", {
      op: "register", reg_id: "register-offline", session: { host: "laptop", name: "author", vendor: "other" },
    })).session;
    client.request("message.send", {
      session_id: session.id, idempotency_key: "offline-message",
      message: { from: "", to: [session.handle], body: "pending" },
    });
    const next = hub.connect("laptop");
    expect(() => client.request("status")).toThrow("disconnected");
    expect(next.request("deliveries.resync", { acked: { [session.id]: 0 } })).toEqual({ replayed: 1 });
    expect(next.deliveries).toEqual(client.deliveries);
    expect(client.deliveries).toHaveLength(1);
    expect(next.request("deliveries.resync", { acked: { [session.id]: 1 } })).toEqual({ replayed: 0 });
    expect(hub.db.prepare("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 1 });
  });

  it("contains an internal failure with the original request id and keeps serving other clients", () => {
    const errors: unknown[] = [];
    const hub = createConformanceHarness({ newId: () => { throw new Error("private internal failure"); }, onError: (e) => errors.push(e) });
    open.push(hub);
    const a = hub.connect("laptop");
    expect(() => a.request("session.upsert", {
      op: "register", reg_id: "register-broken", session: { host: "laptop", name: "author", vendor: "other" },
    })).toThrow("internal error");
    expect(errors).toHaveLength(1);
    expect(hub.connect("server").request("status")).toMatchObject({ sessions: 0, hosts: 2 });
  });
});
