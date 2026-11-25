import { once } from "node:events";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { PROTOCOL_VERSION } from "@kommutator/protocol";
import { HubLink } from "../src/hub-link.js";
import { OfflineError } from "../src/errors.js";

it("backs off real synchronization failures, recovers, and never replays a lost mutation reply", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing fixture address");
  const connections: number[] = [];
  const syncFailures: number[] = [];
  const calls: Array<{ connection: number; method: string }> = [];
  server.on("connection", socket => {
    const connection = connections.push(performance.now());
    socket.on("message", frame => {
      const request = JSON.parse(frame.toString()) as { id: number; method: string };
      calls.push({ connection, method: request.method });
      if (request.method === "hello") {
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { host: "recovery-fixture", protocol_version: PROTOCOL_VERSION } }));
      } else if (request.method === "deliveries.resync" && connection <= 2) {
        syncFailures.push(performance.now());
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "synthetic sync rejection" } }));
      } else if (request.method === "message.send") {
        // Acceptance followed by a lost reply must remain uncertain, not be replayed by HubLink.
        socket.terminate();
      } else socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } }));
    });
  });
  const errors: string[] = [];
  const link = new HubLink({ host: "recovery-fixture", key: "synthetic-recovery-key", hub: `http://127.0.0.1:${address.port}` }, error => errors.push(error));
  let successes = 0;
  try {
    link.start(async () => { await link.request("deliveries.resync", { acked: {} }); successes++; }, () => {});
    await expect.poll(() => successes, { timeout: 3_000, interval: 5 }).toBe(1);
    expect(connections).toHaveLength(3);
    expect(syncFailures).toHaveLength(2);
    // Lower bounds allow timer rounding; exact delay/cap assertions live in fake-timer tests.
    expect((connections[1] ?? 0) - (syncFailures[0] ?? Infinity)).toBeGreaterThanOrEqual(95);
    expect((connections[2] ?? 0) - (syncFailures[1] ?? Infinity)).toBeGreaterThanOrEqual(195);
    expect(link.connected).toBe(true);
    await expect(link.request("message.send", { idempotency_key: "synthetic-lost-reply", body: "fixture" })).rejects.toBeInstanceOf(OfflineError);
    await expect.poll(() => successes, { timeout: 3_000, interval: 5 }).toBe(2);
    expect(connections).toHaveLength(4);
    expect(calls.filter(call => call.method === "message.send")).toEqual([{ connection: 3, method: "message.send" }]);
    expect(calls.filter(call => call.connection === 4).map(call => call.method)).toEqual(["hello", "deliveries.resync"]);
    expect(await link.request("status", {})).toEqual({ ok: true });
    expect(errors).toEqual(["hub synchronization failed", "hub synchronization failed"]);
  } finally {
    await link.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
