import { describe, expect, it } from "vitest";
import { Results } from "../src/results.js";
import { BoardEntry, LIMITS, Message, Methods, Session, TopicName, NewTopicName } from "../src/schemas.js";

describe("Session", () => {
  it("rejects names and hosts that cannot be addressed", () => {
    expect(() => Session.parse({ host: "laptop", name: "a b", vendor: "claude-code" })).toThrow();
    expect(() => Session.parse({ host: "my.host", name: "x", vendor: "claude-code" })).toThrow();
    expect(Session.parse({ host: "Laptop", name: "Author", vendor: "codex" })).toMatchObject({
      host: "laptop",
      name: "author",
    });
  });
});

describe("board limits", () => {
  it("board.put enforces the same key/body limits as BoardEntry", () => {
    const ok = { session_id: "s1", topic: "global", key: "k", body: "x".repeat(LIMITS.boardBody), op_id: "op-00000001" };
    expect(Methods["board.put"].parse(ok).body).toHaveLength(LIMITS.boardBody);
    expect(() => Methods["board.put"].parse({ ...ok, body: "x".repeat(LIMITS.boardBody + 1) })).toThrow();
    expect(() => Methods["board.put"].parse({ ...ok, key: "" })).toThrow();
    expect(() => Methods["board.put"].parse({ ...ok, key: "k".repeat(LIMITS.boardKey + 1) })).toThrow();
    expect(() =>
      BoardEntry.parse({ topic: "global", key: "k", body: "x".repeat(LIMITS.boardBody + 1), version: 1, author: "a@b", updated_at: new Date().toISOString() }),
    ).toThrow();
  });

  it("board.put takes no author — the hub derives it from session_id", () => {
    expect(Methods["board.put"].shape).not.toHaveProperty("author");
    expect(Methods["board.get"].shape).toHaveProperty("session_id");
    expect(Methods["board.history"].shape).toHaveProperty("session_id");
  });
});

describe("Message", () => {
  it("accepts reply_to null and caps recipients", () => {
    expect(Message.parse({ from: "a@b", to: ["c@d"], body: "x", reply_to: null }).reply_to).toBeNull();
    expect(() => Message.parse({ from: "a@b", to: Array(LIMITS.recipients + 1).fill("c@d"), body: "x" })).toThrow();
  });

  it("carries force_wake, default false", () => {
    expect(Message.parse({ from: "a@b", to: ["c@d"], body: "x" }).force_wake).toBe(false);
  });
});

describe("method params", () => {
  it("keeps inbound policy and CLI role on IPC while allowing daemon capability refresh", () => {
    expect(Methods["ipc.hello"].parse({ client: "cli", pid: 1, protocol_version: 1 }).client).toBe("cli");
    const hook = { client: "hook", pid: 1, protocol_version: 1, inbound_policy: "accept" };
    expect(Methods["ipc.hello"].parse(hook).inbound_policy).toBe("accept");
    expect(Methods["ipc.hello"].safeParse({ ...hook, inbound_policy: "unverified" }).success).toBe(false);
    expect(Session.shape).not.toHaveProperty("inbound_policy");
    expect(Methods["session.upsert"].parse({ op: "update", session: { id: "s1", capability: "native" } }).op).toBe("update");
    expect(Methods["session.upsert"].safeParse({ op: "update", session: { id: "s1", host: "other" } }).success).toBe(false);
  });

  it("every session-scoped method requires session_id", () => {
    for (const name of ["session.list", "message.send", "inbox.list", "message.read", "receipt.mark", "topic.join", "topic.leave", "topic.list", "board.get", "board.put", "board.history"] as const) {
      expect(Methods[name].shape, name).toHaveProperty("session_id");
    }
  });

  it("message.send requires an idempotency key", () => {
    expect(() => Methods["message.send"].parse({ session_id: "s", message: { from: "a@b", to: ["c@d"], body: "x" } })).toThrow();
  });

  it("session.upsert separates register / update / reincarnate", () => {
    const session = { host: "laptop", name: "author", vendor: "claude-code" as const };
    // register: no id, reg_id required
    expect(() => Methods["session.upsert"].parse({ op: "register", session })).toThrow();
    const reg = Methods["session.upsert"].parse({ op: "register", session, reg_id: "reg-00000001" });
    expect(reg.op).toBe("register");
    expect(() => Methods["session.upsert"].parse({ op: "register", session: { ...session, id: "s1" }, reg_id: "reg-00000001" })).toThrow();
    // update: id required, no reg_id, incarnation untouched
    expect(() => Methods["session.upsert"].parse({ op: "update", session: { status_line: "x" } })).toThrow();
    expect(Methods["session.upsert"].parse({ op: "update", session: { id: "s1", status_line: "refactoring auth" } }).op).toBe("update");
    // reincarnate: id and a fresh reg_id
    expect(() => Methods["session.upsert"].parse({ op: "reincarnate", session: { ...session, id: "s1" } })).toThrow();
    expect(Methods["session.upsert"].parse({ op: "reincarnate", session: { ...session, id: "s1" }, reg_id: "reg-00000002" }).op).toBe("reincarnate");
    // gone carries incarnation
    expect(() => Methods["session.gone"].parse({ session_id: "s1" })).toThrow();
    expect(Methods["session.gone"].parse({ session_id: "s1", incarnation: 2 }).incarnation).toBe(2);
  });

  it("inbox.list can ask for waking deliveries only; deliveries.resync carries acked seqs", () => {
    expect(Methods["inbox.list"].parse({ session_id: "s1", waking_only: true }).waking_only).toBe(true);
    expect(Methods["inbox.list"].parse({ session_id: "s1" }).waking_only).toBe(false);
    expect(Methods["deliveries.resync"].parse({ acked: { s1: 12, s2: 0 } }).acked["s1"]).toBe(12);
  });

  it("topic.join refuses project and global topics", () => {
    expect(() => Methods["topic.join"].parse({ session_id: "s", name: "project:github.com/x/y" })).toThrow();
    expect(() => Methods["topic.join"].parse({ session_id: "s", name: "global" })).toThrow();
    expect(Methods["topic.join"].parse({ session_id: "s", name: "api-contract-v2" }).name).toBe("api-contract-v2");
  });
});


describe("bounded collection validation", () => {
  for (const [name, schema, limit] of [
    ["recipients", Message.shape.to, LIMITS.recipients],
    ["receipt IDs", Methods["receipt.mark"].shape.ids, LIMITS.receiptIds],
  ] as const) {
    it(`rejects oversized ${name} before reading any elements`, () => {
      const values = Array.from({ length: limit + 1 }, () => "valid");
      let reads = 0;
      Object.defineProperty(values, "0", { get() { reads++; return "valid"; } });
      const result = schema.safeParse(values);
      expect(result.success).toBe(false);
      expect(reads).toBe(0);
      if (!result.success) expect(result.error.issues).toEqual([
        expect.objectContaining({ code: "too_big", maximum: limit, path: [] }),
      ]);
      expect(schema.safeParse(Array.from({ length: limit }, () => "valid")).success).toBe(true);
      expect(schema.safeParse([123]).success).toBe(false);
    });
  }
});

describe("session update defaults", () => {
  it("leaves omitted wake and capability unchanged while retaining registration defaults", () => {
    expect(Methods["session.upsert"].parse({ op: "update", session: { id: "s1", status_line: "Busy" } }))
      .toEqual({ op: "update", session: { id: "s1", status_line: "Busy" } });
    expect(Session.parse({ host: "host", name: "agent", vendor: "other" }))
      .toMatchObject({ state: "active", incarnation: 0, wake: "on", capability: "none" });
  });
});


describe("new topic naming", () => {
  it("uses hyphens without breaking legacy records", () => {
    expect(NewTopicName.parse("kommutator-feedback")).toBe("kommutator-feedback");
    for (const name of ["a b", "a\tb", "a\nb", "a\u00a0b", "a\u0085b"]) {
      expect(NewTopicName.safeParse(name).success).toBe(false);
      expect(TopicName.safeParse(name).success).toBe(true);
    }
  });
});

describe("receipt result compatibility", () => {
  it("accepts legacy acknowledgements without inventing counts and validates complete diagnostics", () => {
    expect(Results["receipt.mark"].parse({ ok: true })).toEqual({ ok: true });
    const result = { ok: true, counts: { requested: 3, matched: 2, marked_read: 1, already_read: 1, unmatched: 1 } };
    expect(Results["receipt.mark"].parse(result)).toEqual(result);
    expect(Results["receipt.mark"].safeParse({ ok: true, counts: { requested: 3 } }).success).toBe(false);
    expect(Results["receipt.mark"].safeParse({ ...result, counts: { ...result.counts, matched: -1 } }).success).toBe(false);
    expect(Results["receipt.mark"].safeParse({ ...result, counts: { ...result.counts, requested: LIMITS.receiptIds + 1 } }).success).toBe(false);
  });
});
