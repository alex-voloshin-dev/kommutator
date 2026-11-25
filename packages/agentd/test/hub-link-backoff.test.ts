import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
import { PROTOCOL_VERSION } from "@kommutator/protocol";
import { HubLink } from "../src/hub-link.js";
import { OfflineError } from "../src/errors.js";

interface SocketFixture extends EventEmitter {
  readyState: number;
  open(): void;
  terminate(): void;
}
const fixture = vi.hoisted(() => ({ sockets: [] as SocketFixture[] }));
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  return { default: class extends EventEmitter implements SocketFixture {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    constructor() { super(); fixture.sockets.push(this); }
    open() { this.readyState = 1; this.emit("open"); }
    send(frame: string) {
      const request = JSON.parse(frame) as { id: number; method: string };
      if (request.method === "hello") this.emit("message", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: request.id,
        result: { host: "backoff-fixture", protocol_version: PROTOCOL_VERSION } })));
    }
    ping() {}
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close");
    }
  } };
});

let link: HubLink;
let errors: string[];
beforeEach(() => {
  vi.useFakeTimers();
  fixture.sockets.length = 0;
  errors = [];
  link = new HubLink({ host: "backoff-fixture", hub: "http://127.0.0.1:1", key: "synthetic-test-key" }, value => errors.push(value));
});
afterEach(async () => { await link.close(); vi.useRealTimers(); });
const current = () => {
  const socket = fixture.sockets.at(-1);
  if (!socket) throw new Error("missing fixture socket");
  return socket;
};
async function open() { current().open(); await vi.advanceTimersByTimeAsync(0); }
async function expectReconnectAfter(delay: number) {
  const before = fixture.sockets.length;
  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(fixture.sockets).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.sockets).toHaveLength(before + 1);
}

it("backs off repeated synchronization failures despite successful hellos, capped at ten seconds", async () => {
  link.start(async () => { throw new Error("synthetic private synchronization failure"); }, () => {});
  for (const delay of [100, 200, 400, 800, 1_600, 3_200, 6_400, 10_000, 10_000]) {
    await open();
    expect(link.connected).toBe(false);
    await expectReconnectAfter(delay);
  }
  expect(errors).toEqual(Array.from({ length: 9 }, () => "hub synchronization failed"));
});

it("resets the delay only after current-socket synchronization succeeds", async () => {
  let attempts = 0;
  link.start(async () => { if (++attempts <= 2) throw new Error("synthetic sync failure"); }, () => {});
  await open(); await expectReconnectAfter(100);
  await open(); await expectReconnectAfter(200);
  await open();
  expect(link.connected).toBe(true);
  current().terminate();
  await expectReconnectAfter(100);
});

it("does not let a superseded successful synchronization reset the successor's backoff", async () => {
  const completions: Array<() => void> = [];
  link.start(() => new Promise<void>(resolve => { completions.push(resolve); }), () => {});
  await open(); current().terminate(); await expectReconnectAfter(100);
  await open();
  completions[0]?.(); await vi.advanceTimersByTimeAsync(0);
  current().terminate();
  await expectReconnectAfter(200);
  completions[1]?.(); await vi.advanceTimersByTimeAsync(0);
  expect(errors).toEqual([]);
});

it("contains successful synchronization after explicit shutdown without reconnecting", async () => {
  let complete!: () => void;
  link.start(() => new Promise<void>(resolve => { complete = resolve; }), () => {});
  await open(); await link.close();
  complete(); await vi.advanceTimersByTimeAsync(20_000);
  expect(fixture.sockets).toHaveLength(1);
  expect(link.connected).toBe(false);
  expect(errors).toEqual([]);
});

it("identifies the triggering timeout without logging payloads or claiming collateral requests timed out", async () => {
  link.start(async () => {}, () => {});
  await open();
  const epoch = link.epoch;
  const trigger = link.request("message.send", { syntheticSecret: "private-body" });
  const triggerResult = trigger.catch(error => error as unknown);
  await vi.advanceTimersByTimeAsync(1_000);
  const collateral = link.request("topic.list", { session_id: "private-owner" });
  const collateralResult = collateral.catch(error => error as unknown);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(await triggerResult).toBeInstanceOf(OfflineError);
  expect(await collateralResult).toBeInstanceOf(OfflineError);
  expect(link.connected).toBe(false);
  expect(errors).toHaveLength(1);
  expect(JSON.parse(errors[0] ?? "null")).toEqual({ event: "hub.request-timeout", method: "message.send",
    request_id: 2, epoch, elapsed_ms: 5_000, pending_count: 2 });
  expect(errors.join(" ")).not.toMatch(/private-body|private-owner|synthetic-test-key|127\.0\.0\.1/);
});

it("does not reflect arbitrary method names in timeout diagnostics", async () => {
  link.start(async () => {}, () => {});
  await open();
  const result = link.request("private-arbitrary-method", { secret: "private-value" }).catch(error => error as unknown);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBeInstanceOf(OfflineError);
  expect(errors).toHaveLength(1);
  expect(JSON.parse(errors[0] ?? "null")).toMatchObject({ event: "hub.request-timeout", method: "unknown" });
  expect(errors.join(" ")).not.toMatch(/private-arbitrary-method|private-value/);
});

it("contains a failing diagnostic sink after rejecting the timed-out request and terminating the socket", async () => {
  link = new HubLink({ host: "backoff-fixture", hub: "http://127.0.0.1:1", key: "synthetic-test-key" }, () => {
    throw new Error("synthetic diagnostic storage failure");
  });
  link.start(async () => {}, () => {});
  await open();
  const result = link.request("topic.list", {}).catch(error => error as unknown);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBeInstanceOf(OfflineError);
  expect(current().readyState).toBe(3);
  expect(link.connected).toBe(false);
});
