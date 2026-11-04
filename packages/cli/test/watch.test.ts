import { describe, expect, it } from "vitest";
import { watch } from "../src/watch.js";
import { IpcError } from "../src/ipc-client.js";
const header = { id: "message", seq: 3, from: "peer@host", kind: "topic", priority: "normal", preview: "untrusted\ntext", thread_id: "thread", created_at: "2026-11-04T00:00:00Z", state: "read", wake: false };
describe("watch process loop", () => {
  it("keeps empty/outage polls silent, preserves cursor under pause, resumes without receipts", async () => {
    const controller = new AbortController();
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [], lines: string[] = [], states: string[] = [];
    const pages = [
      { headers: [], cursor: 1, more: false, state: "watching" },
      new IpcError("untrusted error", -32030),
      { headers: [], cursor: 1, more: false, state: "dnd" },
      { headers: [header], cursor: 4, more: false, state: "watching" },
    ];
    await watch({ session: "session", topic: "feedback", signal: controller.signal }, {
      close() {}, async call(method, params) { calls.push({ method, params }); const page = pages.shift(); if (page instanceof Error) throw page; return page; },
    }, { write: async line => { lines.push(line); }, diagnostic: state => states.push(state), pause: async () => { if (!pages.length) controller.abort(); } });
    expect(calls.map(call => call.method)).toEqual(Array(4).fill("watch.poll"));
    expect(calls.map(call => call.params?.since_seq)).toEqual([undefined, 1, 1, 1]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.split("\n")).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ trust: "untrusted-peer-content", header });
    expect(states).not.toContain("untrusted error");
  });
  it("fails on stdout errors without polling further or acknowledging", async () => {
    const calls: string[] = [];
    await expect(watch({ session: "session", topic: "feedback", sinceSeq: 0 }, {
      close() {}, async call(method) { calls.push(method); return { headers: [header], cursor: 3, more: true, state: "watching" }; },
    }, { write: async () => { throw new Error("broken pipe"); }, diagnostic() {}, pause: async () => {} })).rejects.toThrow("broken pipe");
    expect(calls).toEqual(["watch.poll"]);
  });
  it("does not retry unsupported or unauthorized queries", async () => {
    for (const code of [-32601, -32001, -32020]) {
      let count = 0;
      await expect(watch({ session: "session", topic: "feedback" }, { close() {}, async call() { count++; throw new IpcError("private", code); } },
        { write: async () => {}, diagnostic() {}, pause: async () => {} })).rejects.toThrow(/update|authorization/);
      expect(count).toBe(1);
    }
  });
});

it("terminates malformed pages without emitting or retrying", async () => {
  let calls = 0;
  const lines: string[] = [];
  let pauses = 0;
  await expect(watch({ session: "session", topic: "feedback" }, {
    close() {}, async call() { calls++; return { headers: [{ ...header, seq: -1 }], cursor: 1, more: false, state: "watching" }; },
  }, { write: async line => { lines.push(line); }, diagnostic() {}, pause: async () => { pauses++; throw new Error("unexpected retry"); } }))
    .rejects.toThrow(/invalid watch response/i);
  expect(calls).toBe(1);
  expect(lines).toEqual([]);
  expect(pauses).toBe(0);
});
