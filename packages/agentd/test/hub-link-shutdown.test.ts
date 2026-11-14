import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import type { Socket } from "node:net";
import { WebSocketServer } from "ws";
import { HubLink } from "../src/hub-link.js";
import { OfflineError } from "../src/errors.js";
import { PROTOCOL_VERSION } from "@kommutator/protocol";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const config = (port: number) => ({ host: "shutdown-fixture", hub: `http://127.0.0.1:${port}`, key: "isolated-shutdown-fixture-key" });

it("finishes a connecting socket shutdown before allowing teardown and emits no late callback", async () => {
  const server = createServer(); const sockets = new Set<Socket>();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  const errors: string[] = []; let callbacks = 0;
  const link = new HubLink(config(address.port), message => errors.push(message));
  cleanups.push(() => link.close());
  const upgrade = once(server, "upgrade");
  link.start(async () => { callbacks++; }, () => { callbacks++; });
  await upgrade; // Deliberately leave the opening HTTP upgrade unanswered.
  await Promise.all([link.close(), link.close()]);
  const errorsAtClose = [...errors];
  await tick(); await tick();
  expect(errors).toEqual(errorsAtClose);
  expect(errors).toEqual([]);
  expect(callbacks).toBe(0);
  expect(link.connected).toBe(false);
  await expect(link.request("status", {})).rejects.toBeInstanceOf(OfflineError);
});

it("suppresses a late onConnect rejection after close without reopening or sending", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(wss, "listening");
  cleanups.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  const address = wss.address(); if (!address || typeof address === "string") throw new Error("missing address");
  let connections = 0; const methods: string[] = [];
  wss.on("connection", socket => { connections++; socket.on("message", frame => {
    const request = JSON.parse(frame.toString()) as { id: number; method: string }; methods.push(request.method);
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { host: "shutdown-fixture", protocol_version: PROTOCOL_VERSION } }));
  }); });
  const errors: string[] = []; let entered!: () => void; let reject!: (error: Error) => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>((_resolve, fail) => { reject = fail; });
  const link = new HubLink(config(address.port), message => errors.push(message)); cleanups.push(() => link.close());
  link.start(async () => { entered(); await held; }, () => { throw new Error("unexpected notification"); });
  await ready; await link.close();
  reject(new Error("late synchronization failure")); await tick(); await tick();
  await expect(link.request("status", {})).rejects.toBeInstanceOf(OfflineError);
  link.start(async () => { throw new Error("restarted stopped link"); }, () => {});
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(errors).toEqual([]); expect(connections).toBe(1); expect(methods).toEqual(["hello"]);
});

it("closes a link that never started, idempotently", async () => {
  const errors: string[] = []; const link = new HubLink(config(1), error => errors.push(error));
  await Promise.all([link.close(), link.close()]);
  link.start(async () => { throw new Error("closed link started"); }, () => {});
  await tick(); expect(errors).toEqual([]); expect(link.connected).toBe(false);
});

it("closes an already closed socket and cancels reconnect without changing request uncertainty", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(wss, "listening");
  cleanups.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  const address = wss.address(); if (!address || typeof address === "string") throw new Error("missing address");
  let connections = 0; let entered!: () => void; const requested = new Promise<void>(resolve => { entered = resolve; });
  wss.on("connection", socket => { connections++; socket.on("message", frame => {
    const request = JSON.parse(frame.toString()) as { id: number; method: string };
    if (request.method === "hello") socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { host: "shutdown-fixture", protocol_version: PROTOCOL_VERSION } }));
    else { entered(); socket.terminate(); }
  }); });
  const errors: string[] = []; const link = new HubLink(config(address.port), error => errors.push(error)); cleanups.push(() => link.close());
  let connected!: () => void; const ready = new Promise<void>(resolve => { connected = resolve; });
  link.start(async () => { connected(); }, () => {}); await ready;
  const result = link.request("message.send", { synthetic: true });
  const rejected = expect(result).rejects.toBeInstanceOf(OfflineError);
  await requested; await rejected;
  expect(link.connected).toBe(false);
  await Promise.all([link.close(), link.close()]);
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(connections).toBe(1); expect(errors).toEqual([]);
});
it("rejects an in-flight request on explicit shutdown without replay or false confirmation", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 }); await once(wss, "listening");
  cleanups.push(async () => { for (const socket of wss.clients) socket.terminate(); await new Promise<void>(resolve => wss.close(() => resolve())); });
  const address = wss.address(); if (!address || typeof address === "string") throw new Error("missing address");
  let connections = 0; const methods: string[] = [];
  let entered!: () => void; const requested = new Promise<void>(resolve => { entered = resolve; });
  wss.on("connection", socket => { connections++; socket.on("message", frame => {
    const request = JSON.parse(frame.toString()) as { id: number; method: string }; methods.push(request.method);
    if (request.method === "hello") socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { host: "shutdown-fixture", protocol_version: PROTOCOL_VERSION } }));
    else entered(); // Unknown remote outcome: deliberately do not acknowledge.
  }); });
  const errors: string[] = []; const link = new HubLink(config(address.port), error => errors.push(error)); cleanups.push(() => link.close());
  let connected!: () => void; const ready = new Promise<void>(resolve => { connected = resolve; });
  link.start(async () => { connected(); }, () => {}); await ready;
  const pending = link.request("message.send", { synthetic: true });
  const rejected = expect(pending).rejects.toBeInstanceOf(OfflineError);
  await requested;
  const closing = link.close(); expect(link.close()).toBe(closing);
  await closing; await rejected;
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(connections).toBe(1); expect(methods).toEqual(["hello", "message.send"]); expect(errors).toEqual([]);
});
