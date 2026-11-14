import { afterEach, expect, it } from "vitest";
import { RESYNC_PAGE_BYTES, Results } from "@kommutator/protocol";
import { createConformanceHarness } from "../src/testing.js";
const hubs: ReturnType<typeof createConformanceHarness>[] = [];
afterEach(() => hubs.splice(0).forEach(h => h.close()));
function fixture(body = "small", count = 70) {
  const hub = createConformanceHarness(); hubs.push(hub);
  const client = hub.connect("test");
  const session = Results["session.upsert"].parse(client.request("session.upsert", {
    op: "register", reg_id: "register", session: { host: "test", name: "receiver", vendor: "other" },
  })).session;
  const send = (key: string, content = body) => client.request("message.send", { session_id: session.id,
    idempotency_key: key, message: { from: "", to: [session.handle], body: content } });
  for (let i = 0; i < count; i++) send(`message-${i}`);
  client.deliveries.splice(0);
  const page = (after: number, through?: number) => Results["deliveries.resync.page"].parse(client.request("deliveries.resync.page", {
    session_id: session.id, after, ...(through === undefined ? {} : { through }),
  }));
  return { hub, client, session, send, page };
}
it("bounds count, fixes highwater despite arrivals and leaves receipts/events unchanged", () => {
  const { hub, client, page, send } = fixture();
  const first = page(0);
  expect(first).toMatchObject({ through: 70, cursor: 32, more: true });
  expect(first.deliveries).toHaveLength(32);
  send("later-message"); client.deliveries.splice(0);
  const second = page(first.cursor, first.through);
  const third = page(second.cursor, first.through);
  expect(third).toMatchObject({ cursor: 70, more: false });
  expect([...first.deliveries, ...second.deliveries, ...third.deliveries]).toHaveLength(70);
  expect(client.deliveries).toEqual([]);
  expect(hub.db.prepare("SELECT count(*) AS n FROM deliveries WHERE state='unread'").get()).toEqual({ n: 71 });
  expect(page(70, 70)).toMatchObject({ cursor: 70, more: false, deliveries: [] });
});
it.each(["x".repeat(60_000), "\u0000".repeat(60_000), "😀".repeat(30_000)])("bounds encoded bytes and replays without truncation", body => {
  const { page } = fixture(body, 20);
  let cursor = 0; let count = 0;
  do {
    const result = page(cursor, 20);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(RESYNC_PAGE_BYTES);
    for (const delivery of result.deliveries) expect(delivery.message.body).toBe(body);
    expect(page(cursor, 20)).toEqual(result);
    cursor = result.cursor; count += result.deliveries.length;
    if (!result.more) break;
  } while (cursor < 20);
  expect(count).toBe(20);
});
it("reauthorizes every page and honors DND and read gaps", () => {
  const { hub, client, session, page } = fixture();
  const first = page(0);
  client.request("receipt.mark", { session_id: session.id, ids: first.deliveries.map(d => d.message.id), state: "read" });
  client.request("session.upsert", { op: "update", session: { id: session.id, wake: "off" } });
  expect(page(0).deliveries.every(d => d.seq > 32 && !d.wake)).toBe(true);
  const foreign = hub.connect("foreign");
  expect(() => foreign.request("deliveries.resync.page", { session_id: session.id, after: 0 })).toThrow("does not belong");
  client.request("session.gone", { session_id: session.id, incarnation: 0 });
  expect(() => page(0)).toThrow("gone");
});
it("rejects malformed target cardinality without partial events", () => {
  const { hub, page, client } = fixture("small", 1);
  hub.db.exec(`INSERT INTO message_targets SELECT message_id, target_type, target_id FROM message_targets`);
  for (let i = 0; i < 4; i++) hub.db.exec(`INSERT INTO message_targets SELECT message_id, target_type, target_id FROM message_targets`);
  expect(() => page(0)).toThrow("invalid stored message targets");
  expect(client.deliveries).toEqual([]);
});
it("uses indexed range, highwater, message/author and bounded target reconstruction", () => {
  const { hub, page } = fixture("small", 500);
  hub.db.exec("UPDATE deliveries SET state='read' WHERE seq < 495");
  // Large unrelated target history must not turn each body reconstruction into a table scan.
  for (let i = 0; i < 8; i++) hub.db.exec(`INSERT INTO message_targets SELECT message_id, target_type, target_id
    FROM message_targets WHERE message_id IN (SELECT message_id FROM deliveries WHERE seq < 495)`);
  expect(page(0).deliveries).toHaveLength(6);
  const plan = (sql: string) => hub.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(r => String(r.detail)).join("\n");
  expect(plan("SELECT message_id, seq, wake FROM deliveries WHERE session_id='x' AND state='unread' AND seq>0 AND seq<=999 ORDER BY seq LIMIT 33")).toContain("deliveries_unread_session_seq");
  expect(plan("SELECT MAX(seq) FROM deliveries WHERE session_id='x'")).toMatch(/SEARCH deliveries USING COVERING INDEX/);
  expect(plan("SELECT target_type,target_id FROM message_targets WHERE message_id='x' LIMIT 21")).toContain("message_targets_message_id");
  const message = plan("SELECT m.*,s.handle FROM messages m JOIN sessions s ON s.id=m.from_session WHERE m.id='x'");
  expect(message).not.toMatch(/SCAN|TEMP B-TREE/);
});
