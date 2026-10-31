import { describe, expect, it } from "vitest";
import { codePoints, makePreview, MessageHeader, packHeaders, renderHeader } from "../src/headers.js";
import { Results } from "../src/results.js";
import { LIMITS, Message, Methods, Notifications } from "../src/schemas.js";

function header(seq: number, preview = "hello"): MessageHeader {
  return {
    id: `m${seq}`,
    seq,
    from: "reviewer@laptop",
    kind: "dm",
    priority: "normal",
    preview,
    thread_id: `m${seq}`,
    created_at: "2026-10-24T17:00:00.000Z",
    state: "unread",
    wake: true,
  };
}

describe("makePreview", () => {
  it("takes the first line and caps it at LIMITS.preview code points", () => {
    expect(makePreview("one\ntwo")).toBe("one");
    expect(makePreview("x".repeat(64_000))).toHaveLength(LIMITS.preview);
    expect(codePoints(makePreview("🙂".repeat(300)))).toBe(LIMITS.preview);
    expect(makePreview("")).toBe("");
  });

  it("valid Message → makePreview → MessageHeader → inbox.list result all agree on the unit (T02)", () => {
    for (const body of ["🙂".repeat(300), "a🙂".repeat(200), "x".repeat(64_000), "日本語".repeat(100) + "\nsecond line", "plain"]) {
      const msg = Message.parse({ from: "a@b", to: ["c@d"], body });
      const h = { ...header(1), preview: makePreview(msg.body) };
      expect(MessageHeader.safeParse(h).success, body.slice(0, 10)).toBe(true);
      expect(Results["inbox.list"].safeParse({ headers: [h], cursor: 1, more: false }).success).toBe(true);
    }
  });

  it("the schema rejects a preview over the limit in code points, not UTF-16 units", () => {
    const tooLong = { ...header(1), preview: "🙂".repeat(LIMITS.preview + 1) };
    expect(MessageHeader.safeParse(tooLong).success).toBe(false);
    const exact = { ...header(1), preview: "🙂".repeat(LIMITS.preview) }; // 400 UTF-16 units, 200 code points
    expect(MessageHeader.safeParse(exact).success).toBe(true);
  });
});

describe("packHeaders", () => {
  it("shows at most five and reports the rest as omitted", () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => header(n));
    const p = packHeaders(six);
    expect(p.shown.map((h) => h.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(p.omitted).toBe(1);
    expect(p.text).toContain("+1 more");
    expect(p.text).toContain("id=m1");
  });

  it("never exceeds the budget, even with maximal or emoji previews", () => {
    const fat = [1, 2, 3, 4, 5, 6].map((n) => header(n, "y".repeat(LIMITS.preview)));
    const p = packHeaders(fat, { budgetChars: 600 });
    expect(codePoints(p.text)).toBeLessThanOrEqual(600);
    expect(p.shown.length).toBeGreaterThan(0);
    expect(p.shown.length + p.omitted).toBe(6);
    const emoji = [1, 2, 3].map((n) => header(n, "🙂".repeat(LIMITS.preview)));
    const q = packHeaders(emoji, { budgetChars: 300 });
    expect(codePoints(q.text)).toBeLessThanOrEqual(300);
  });

  it("handles tiny and exact budgets (T04)", () => {
    const one = header(1);
    const exact = codePoints(renderHeader(one));
    // Exact fit for the only header: shown, no trailer.
    const fit = packHeaders([one], { budgetChars: exact });
    expect(fit.shown).toHaveLength(1);
    expect(fit.omitted).toBe(0);
    expect(codePoints(fit.text)).toBe(exact);
    // One short: not shown; the trailer fits or the text is empty — never over budget.
    const short = packHeaders([one], { budgetChars: exact - 1 });
    expect(short.shown).toHaveLength(0);
    expect(short.omitted).toBe(1);
    expect(codePoints(short.text)).toBeLessThanOrEqual(exact - 1);
    // Budget smaller than the trailer: empty text, everything omitted.
    for (const b of [0, 1, 10]) {
      const p = packHeaders([one, header(2)], { budgetChars: b });
      expect(p.text).toBe("");
      expect(p.shown).toHaveLength(0);
      expect(p.omitted).toBe(2);
    }
  });

  it("shows two short headers that fit exactly without a trailer (H04)", () => {
    const two = [header(1, ""), header(2, "")];
    const exact = codePoints(two.map(renderHeader).join("\n"));
    const p = packHeaders(two, { budgetChars: exact });
    expect(p.shown).toHaveLength(2);
    expect(p.omitted).toBe(0);
    expect(codePoints(p.text)).toBe(exact);
    // One short: exactly one header plus the trailer, if that fits; never over budget.
    const q = packHeaders(two, { budgetChars: exact - 1 });
    expect(q.shown.length + q.omitted).toBe(2);
    expect(codePoints(q.text)).toBeLessThanOrEqual(exact - 1);
  });

  it("picks the largest prefix that fits, for every budget from 0 to generous", () => {
    const hs = [1, 2, 3, 4, 5, 6, 7].map((n) => header(n, "p".repeat(n * 7)));
    const generous = codePoints(hs.slice(0, 5).map(renderHeader).join("\n")) + 60;
    for (let b = 0; b <= generous; b++) {
      const p = packHeaders(hs, { budgetChars: b });
      expect(codePoints(p.text), `budget ${b}`).toBeLessThanOrEqual(b);
      expect(p.shown.length + p.omitted).toBe(7);
      expect(p.shown.length).toBeLessThanOrEqual(5);
      // Maximality: one more header would not have fit.
      if (p.shown.length < 5) {
        const more = packHeaders(hs.slice(0, p.shown.length + 1), { budgetChars: b, maxCount: p.shown.length + 1 });
        const moreCost = codePoints(hs.slice(0, p.shown.length + 1).map(renderHeader).join("\n")) + (7 - p.shown.length - 1 > 0 ? 1 + codePoints(`+${7 - p.shown.length - 1} more unread — call inbox() to see them`) : 0);
        expect(more.shown.length <= p.shown.length + 1).toBe(true);
        expect(moreCost > b || p.shown.length === 5).toBe(true);
      }
    }
  });

  it("every shown header carries the message id the agent needs for read/ack/reply_to", () => {
    const p = packHeaders([header(7)]);
    expect(p.shown[0]?.id).toBe("m7");
    expect(p.text).toMatch(/id=m7/);
  });
});

describe("delivery schemas", () => {
  it("deliver requires a hub-assigned message id, thread and timestamp", () => {
    const base = { session_id: "s1", seq: 1, wake: true };
    expect(() => Notifications.deliver.parse({ ...base, message: { from: "a@b", to: ["c@d"], body: "x" } })).toThrow();
    expect(
      Notifications.deliver.parse({
        ...base,
        message: { id: "m1", thread_id: "m1", created_at: "2026-10-24T17:00:00.000Z", from: "a@b", to: ["c@d"], body: "x" },
      }).message.id,
    ).toBe("m1");
  });

  it("ipc.hello keeps pid and session-binding facts", () => {
    const h = Methods["ipc.hello"].parse({
      client: "hook",
      protocol_version: 1,
      pid: 4242,
      ppid: 4100,
      cwd: "/repo",
      vendor: "claude-code",
      vendor_session_id: "abc",
      endpoint: "/tmp/cc-socks-501/x.sock",
      token: "t",
      permission_mode: "default",
    });
    expect(h.pid).toBe(4242);
    expect(h.vendor_session_id).toBe("abc");
    expect(h.endpoint).toContain("cc-socks");
  });

  it("board.put requires an op_id for replay correlation", () => {
    expect(() => Methods["board.put"].parse({ session_id: "s", topic: "global", key: "k", body: "b" })).toThrow();
    expect(Methods["board.put"].parse({ session_id: "s", topic: "global", key: "k", body: "b", op_id: "op-00000001" }).op_id).toBe("op-00000001");
  });
});
