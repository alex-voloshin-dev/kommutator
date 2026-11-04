import { afterEach, describe, expect, it } from "vitest";
import { Results } from "@kommutator/protocol";
import { createConformanceHarness } from "../src/testing.js";
const open: ReturnType<typeof createConformanceHarness>[] = [];
afterEach(() => { for (const hub of open.splice(0)) hub.close(); });
function fixture() {
  const hub = createConformanceHarness(); open.push(hub);
  const host = hub.connect("local"), remote = hub.connect("remote");
  const register = (name: string) => Results["session.upsert"].parse(host.request("session.upsert", {
    op: "register", reg_id: `register-${name}`, session: { host: "local", name, vendor: "other" },
  })).session;
  const sender = register("sender"), receiver = register("receiver");
  const a = host.bindSession(sender.id), b = host.bindSession(receiver.id);
  for (const client of [a, b]) for (const name of ["feedback", "other-topic"]) client.request("topic.join", { name });
  let seq = 0;
  const send = (to: string, priority = "normal") => Results["message.send"].parse(a.request("message.send", {
    idempotency_key: `message-${++seq}`, message: { from: "ignored@local", to: [to], body: "untrusted report", kind: "topic", priority },
  }));
  const poll = (params: Record<string, unknown> = {}) => Results["watch.poll"].parse(host.request("watch.poll", { session_id: receiver.id, topic: "feedback", ...params }));
  return { hub, host, remote, receiver, a, b, send, poll };
}
describe("topic watch authorized observation", () => {
  it("tails future deliveries and independently pages read headers without receipts", () => {
    const { b, send, poll } = fixture();
    send("topic:feedback");
    expect(poll()).toMatchObject({ headers: [], cursor: 1 });
    const read = send("topic:feedback");
    b.request("message.read", { id: read.id });
    send("topic:feedback", "fyi");
    send("topic:other-topic");
    const last = send("topic:feedback");
    const before = b.request("inbox.list", { unread_only: true });
    const first = poll({ since_seq: 1, limit: 1 });
    expect(first).toMatchObject({ headers: [{ id: read.id, state: "read" }], cursor: 2, more: true });
    expect(poll({ since_seq: first.cursor, limit: 1 })).toMatchObject({ headers: [{ id: last.id }], cursor: 5, more: false });
    expect(b.request("inbox.list", { unread_only: true })).toEqual(before);
  });
  it("advances past direct deliveries and hop-limited topic replies without receipts", () => {
    const { a, b, receiver, send, poll } = fixture();
    send(receiver.handle);
    let parent: string | undefined;
    for (let i = 0; i < 5; i++) {
      parent = Results["message.send"].parse(a.request("message.send", {
        idempotency_key: `hop-message-${i}`, message: { from: "ignored@local", to: ["topic:feedback"], body: "reply", kind: "request", ...(parent ? { reply_to: parent } : {}) },
      })).id;
    }
    const before = b.request("inbox.list", { unread_only: true });
    const page = poll({ since_seq: 0 });
    expect(page.headers.map(header => header.seq)).toEqual([2, 3, 4, 5]);
    expect(page.cursor).toBe(6);
    expect(b.request("inbox.list", { unread_only: true })).toEqual(before);
  });
  it("pauses ended hub sessions without rejecting or advancing either cursor mode", () => {
    const { b, poll } = fixture();
    b.request("session.gone", { incarnation: 0 });
    expect(poll()).toEqual({ headers: [], more: false, state: "gone" });
    expect(poll({ since_seq: 2 })).toEqual({ headers: [], more: false, state: "gone", cursor: 2 });
  });
  it("requires host ownership and current membership; pause preserves uninitialized and explicit cursors", () => {
    const { host, remote, receiver, b, poll } = fixture();
    expect(() => remote.request("watch.poll", { session_id: receiver.id, topic: "feedback" })).toThrow();
    host.request("session.upsert", { op: "update", session: { id: receiver.id, wake: "off" } });
    expect(poll()).toEqual({ headers: [], more: false, state: "dnd" });
    expect(poll({ since_seq: 7 })).toEqual({ headers: [], more: false, state: "dnd", cursor: 7 });
    b.request("topic.leave", { name: "feedback" });
    expect(() => poll()).toThrow("membership");
  });
});
