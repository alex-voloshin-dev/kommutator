import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createConformanceHarness, RemoteRpcError } from "@kommutator/hub/testing";
import { PROTOCOL_VERSION, Results, RegisteredSession } from "@kommutator/protocol";
import { DaemonCore, type IpcPeer } from "../src/core.js";
import { OfflineError, RpcError } from "../src/errors.js";
import type { HubTransport } from "../src/hub-link.js";
import { claudeAdapter } from "../src/adapters/claude.js";
import type { Adapter } from "../src/adapters/types.js";
import type { Clock } from "../src/wake.js";

const config = { host: "mac", hub: "http://127.0.0.1:8787", key: "test-key-with-16-characters" };
const Identity = z.object({ session: RegisteredSession, topics: z.array(z.object({ name: z.string(), kind: z.string() })) });
const HelloReply = z.object({ bound: z.boolean(), pending: z.boolean().optional(), session: RegisteredSession.optional() });
const PollReply = z.object({ headers: z.array(z.object({ id: z.string() })), block: z.boolean() });

class ManualClock implements Clock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.time; }
  setTimeout(callback: () => void, ms: number) { const id = ++this.next; this.timers.set(id, { at: this.time + ms, callback }); return id; }
  clearTimeout(timer: unknown) { if (typeof timer === "number") this.timers.delete(timer); }
  async advance(ms: number) {
    this.time += ms;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= this.time);
      if (!due.length) break;
      for (const [id, timer] of due) { this.timers.delete(id); timer.callback(); }
      for (let i = 0; i < 30; i++) await Promise.resolve();
    }
  }
}

class FakeTransport implements HubTransport {
  connected = false;
  peer: ReturnType<ReturnType<typeof createConformanceHarness>["connect"]> | undefined;
  onConnect: (() => Promise<void>) | undefined;
  notify: ((method: string, params: unknown) => void) | undefined;
  ready: Promise<void> = Promise.resolve();
  calls: Array<{ method: string; params: unknown }> = [];
  loseAck: string | undefined;
  dropDeliver = false;
  afterRequest: ((method: string) => Promise<void>) | undefined;
  constructor(readonly hub: ReturnType<typeof createConformanceHarness>) {}
  start(onConnect: () => Promise<void>, notify: (method: string, params: unknown) => void) { this.onConnect = onConnect; this.notify = notify; }
  async reconnect() {
    this.peer = this.hub.connect(config.host);
    this.connected = true;
    this.ready = this.onConnect?.() ?? Promise.resolve();
    await this.ready;
  }
  async request(method: string, params: unknown): Promise<unknown> {
    if (!this.connected || !this.peer) throw new OfflineError();
    this.calls.push({ method, params });
    let result: unknown;
    try { result = this.peer.request(method, params); }
    catch (error) { if (error instanceof RemoteRpcError) throw new RpcError(error.code, error.message); throw error; }
    const deliveries = this.peer.deliveries.splice(0);
    if (!this.dropDeliver) for (const delivery of deliveries) this.notify?.("deliver", delivery);
    if (this.loseAck === method) { this.loseAck = undefined; this.disconnect(); throw new OfflineError("lost ACK"); }
    await this.afterRequest?.(method);
    return result;
  }
  disconnect() { this.connected = false; this.peer?.disconnect(); }
  async close() { this.disconnect(); }
}
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(options: { online?: boolean; dbPath?: string; clock?: ManualClock; hub?: ReturnType<typeof createConformanceHarness>; birth?: (pid: number) => Promise<string | undefined>; alive?: boolean } = {}) {
  const hub = options.hub ?? createConformanceHarness();
  if (!options.hub) cleanup.push(async () => hub.close());
  const transport = new FakeTransport(hub);
  const clock = options.clock ?? new ManualClock();
  const attempts: Array<{ id: string | undefined; at: number }> = [];
  const adapter: Adapter = { vendor: "claude-code", capability: "native", isAlive: async () => true, deliver: async (_record, message, wake) => {
    if (wake) attempts.push({ id: message.id, at: clock.time });
    return wake ? { outcome: "written" } : { outcome: "inbox" };
  } };
  const core = new DaemonCore({ config, dbPath: options.dbPath ?? ":memory:", transport, clock, adapters: [adapter], processStart: options.birth ?? (async () => "birth"), ...(options.alive === undefined ? { isAlive: async () => true } : {} ) });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await core.close(); } };
  cleanup.push(close);
  await core.start();
  if (options.online !== false) await transport.reconnect();
  return { core, transport, hub, clock, attempts, adapter, close };
}
async function hook(core: DaemonCore, id: string, extra: Record<string, unknown> = {}) {
  const peer = core.peer();
  const result = HelloReply.parse(await core.request(peer, "ipc.hello", { client: "hook", protocol_version: PROTOCOL_VERSION, pid: 1000, ppid: 55, vendor: "claude-code", vendor_session_id: id, cwd: "/repo", endpoint: "/tmp/fake.sock", permission_mode: "default", ...extra }));
  return { peer, session: result.session };
}
async function shim(core: DaemonCore, id?: string) {
  const peer = core.peer();
  await core.request(peer, "ipc.hello", { client: "shim", protocol_version: PROTOCOL_VERSION, pid: 3000, ppid: 55, vendor: "claude-code", cwd: "/repo", ...(id ? { vendor_session_id: id } : {}) });
  return peer;
}
async function cli(core: DaemonCore) {
  const peer = core.peer();
  await core.request(peer, "ipc.hello", { client: "cli", protocol_version: PROTOCOL_VERSION, pid: 4000, cwd: "/repo" });
  return peer;
}
async function send(core: DaemonCore, peer: IpcPeer, to: string, body = "message") {
  return Results["send.local"].parse(await core.request(peer, "message.send", { message: { to: [to], body } }));
}

describe("daemon identity and IPC authorization", () => {
  it("keeps socket diagnostics CLI-only and excludes credentials, endpoints and gone sessions", async () => {
    const { core } = await fixture();
    const home = await mkdtemp(join(tmpdir(), "kom-diag-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));
    const endpoint = join(home, "live.sock");
    const socket = createServer();
    await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(endpoint, resolve); });
    cleanup.push(() => new Promise<void>((resolve) => socket.close(() => resolve())));
    const a = await hook(core, "a", { endpoint, token: "private-vendor-token" });
    const b = await hook(core, "b", { endpoint: join(home, "missing.sock") });
    const notSocket = join(home, "file"); await writeFile(notSocket, "not a socket");
    const c = await hook(core, "c", { endpoint: notSocket });
    const gone = await hook(core, "gone");
    await core.request(gone.peer, "session.gone", {});
    await expect(core.request(core.peer(), "daemon.diagnostics")).rejects.toThrow(/ipc.hello/);
    await expect(core.request(a.peer, "daemon.diagnostics")).rejects.toThrow(/CLI/);
    await expect(core.request(await shim(core, "a"), "daemon.diagnostics")).rejects.toThrow(/CLI/);
    const result = await core.request(await cli(core), "daemon.diagnostics");
    expect(result).toEqual({ codex_sessions: [], claude_sessions: [
      { id: a.session?.id, endpoint_configured: true, socket_present: true },
      { id: b.session?.id, endpoint_configured: true, socket_present: false },
      { id: c.session?.id, endpoint_configured: true, socket_present: false },
    ] });
    expect(JSON.stringify(result)).not.toContain(home);
    expect(JSON.stringify(core.status())).not.toContain(endpoint);
    expect(JSON.stringify(core.status())).not.toContain("private-vendor-token");
  });

  it("exposes current health separately from the timestamped historical error", async () => {
    const { core, transport, clock } = await fixture();
    expect(core.status()).toMatchObject({ daemon: { running: true }, health: { state: "healthy" } });
    clock.time = 123;
    core.report("hub WebSocket connection failed");
    transport.disconnect();
    expect(core.status()).toMatchObject({ health: { state: "degraded" }, last_error: "hub WebSocket connection failed", last_error_at: 123 });
    await transport.reconnect();
    expect(core.status()).toMatchObject({ health: { state: "healthy" }, last_error_at: 123 });
  });
  it("binds same-cwd shims by exact vendor id and refuses an ambiguous or unknown id", async () => {
    const { core } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    const sa = await shim(core, "a");
    const sb = await shim(core, "b");
    expect(Identity.parse(await core.request(sa, "whoami")).session.id).toBe(a.session?.id);
    expect(Identity.parse(await core.request(sb, "whoami")).session.id).toBe(b.session?.id);
    expect(a.session?.id).not.toBe(b.session?.id);
    await expect(core.request(await shim(core), "whoami")).rejects.toThrow(/ambiguous/);
    await expect(core.request(await shim(core, "unknown"), "whoami")).rejects.toThrow(/waiting for its hook/);
  });
  it("separates simultaneous owners of one Claude conversation and pins their private traffic", async () => {
    const { core } = await fixture();
    const [a, b] = await Promise.all([hook(core, "resumed", { ppid: 55 }), hook(core, "resumed", { ppid: 66 })]);
    const connectOwner = async (ppid: number) => {
      const peer = core.peer();
      await core.request(peer, "ipc.hello", { client: "shim", protocol_version: PROTOCOL_VERSION, pid: ppid + 1000, ppid, vendor: "claude-code", vendor_session_id: "resumed", cwd: "/repo" });
      return peer;
    };
    const sa = await connectOwner(55), sb = await connectOwner(66);
    const first = Identity.parse(await core.request(sa, "whoami")).session;
    const second = Identity.parse(await core.request(sb, "whoami")).session;
    expect(first.id).not.toBe(second.id);
    expect(first.handle).not.toBe(second.handle);
    expect(first.vendor_session_id).toBe(second.vendor_session_id);
    await core.request(sa, "session.upsert", { op: "update", session: { status_line: "first owner" } });
    await core.request(sb, "session.upsert", { op: "update", session: { status_line: "second owner" } });
    expect(Identity.parse(await core.request(sa, "whoami")).session.status_line).toBe("first owner");
    expect(Identity.parse(await core.request(sb, "whoami")).session.status_line).toBe("second owner");
    await send(core, sa, second.handle, "only second may read");
    expect(Results["inbox.list"].parse(await core.request(sa, "inbox.list", {})).headers).toHaveLength(0);
    expect(Results["inbox.list"].parse(await core.request(sb, "inbox.list", {})).headers).toHaveLength(1);
    await hook(core, "resumed", { ppid: 55 });
    await hook(core, "resumed", { ppid: 66 });
    expect(Identity.parse(await core.request(sa, "whoami")).session.incarnation).toBe(0);
    expect(Identity.parse(await core.request(sb, "whoami")).session.incarnation).toBe(0);
    await core.request(a.peer, "session.gone");
    await expect(core.request(sa, "whoami")).rejects.toThrow(/ended/);
    expect(Identity.parse(await core.request(sb, "whoami")).session.id).toBe(b.session?.id);
    const stranger = await connectOwner(77);
    await expect(core.request(stranger, "whoami")).rejects.toThrow(/waiting for its hook/);
  });
  it("downgrades an ambiguous duplicate-root native socket and never wakes through it", async () => {
    const { core, clock, attempts } = await fixture();
    const a = await hook(core, "shared-endpoint", { ppid: 55 });
    const b = await hook(core, "shared-endpoint", { ppid: 66 });
    expect(Identity.parse(await core.request(a.peer, "whoami")).session.capability).toBe("hook");
    expect(Identity.parse(await core.request(b.peer, "whoami")).session.capability).toBe("hook");
    if (!b.session?.handle) throw new Error("missing test handle");
    await send(core, a.peer, b.session.handle);
    await clock.advance(10_000);
    expect(attempts).toHaveLength(0);
    expect(Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", {})).headers).toHaveLength(1);
  });
  it("does not treat an unavailable process probe as proof that an owner exited", async () => {
    let unavailable = false;
    const { core } = await fixture({ birth: async pid => unavailable && pid === process.pid ? undefined : "birth" });
    const a = await hook(core, "probe-error", { ppid: process.pid });
    unavailable = true;
    const b = await hook(core, "probe-error", { ppid: process.pid + 1 });
    expect(b.session?.id).not.toBe(a.session?.id);
    expect(core.registry.all()).toHaveLength(2);
  });
  it("does not inherit a dead owner's project when the resumed process changes cwd", async () => {
    let birth = "first";
    const { core } = await fixture({ birth: async () => birth });
    const a = await hook(core, "moved", { cwd: "/old-project" });
    await expect(hook(core, "moved", { cwd: "/other-project" })).rejects.toThrow(/Conflicting project context/);
    birth = "next";
    const b = await hook(core, "moved", { cwd: "/other-project" });
    expect(b.session?.id).not.toBe(a.session?.id);
    expect(b.session?.cwd).toBe("/other-project");
    expect(b.session?.project_key).not.toBe(a.session?.project_key);
  });
  it("does not let a pinned Claude peer follow a reused process generation", async () => {
    let birth = "first";
    const { core } = await fixture({ birth: async () => birth });
    await hook(core, "generation");
    const old = await shim(core, "generation");
    const first = Identity.parse(await core.request(old, "whoami")).session;
    birth = "next";
    const revived = await hook(core, "generation");
    expect(revived.session?.id).toBe(first.id);
    expect(revived.session?.incarnation).toBe(1);
    await expect(core.request(old, "session.upsert", { op: "update", session: { status_line: "stale write" } })).rejects.toThrow(/owner has changed/);
  });
  it.each(["session.upsert", "whoami", "inbox.list", "hook.poll"])("rejects a stale %s after an owner probe races replacement", async method => {
    let birth = "old";
    let entered: () => void = () => {};
    const probing = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let pause = false;
    const { core } = await fixture({ birth: async () => {
      const observed = birth;
      if (pause) { pause = false; entered(); await held; }
      return observed;
    } });
    await hook(core, "probe-race");
    const peer = await shim(core, "probe-race");
    pause = true;
    const pending = core.request(peer, method, method === "session.upsert" ? { op: "update", session: { status_line: "stale" } } : method === "hook.poll" ? { event: "Stop" } : {});
    const rejected = expect(pending).rejects.toThrow(/owner has changed/);
    await probing;
    birth = "new";
    const successor = await hook(core, "probe-race");
    await core.request(successor.peer, "session.upsert", { op: "update", session: { status_line: "successor" } });
    release();
    await rejected;
    const current = Identity.parse(await core.request(successor.peer, "whoami")).session;
    expect(current.status_line).toBe("successor");
    expect(current.state).toBe("active");
  });
  it("pins an unbound peer's first observed birth across a registration race", async () => {
    let birth = "old";
    let entered: () => void = () => {};
    const probing = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let pause = false;
    const { core } = await fixture({ birth: async () => {
      const observed = birth;
      if (pause) { pause = false; entered(); await held; }
      return observed;
    } });
    await hook(core, "unbound-race");
    pause = true;
    const pending = shim(core, "unbound-race");
    await probing;
    birth = "new";
    await hook(core, "unbound-race");
    release();
    const old = await pending;
    await expect(core.request(old, "whoami")).rejects.toThrow(/owner has changed/);
  });
  it.each(["whoami", "inbox.list"])("rechecks %s after flush before querying a successor", async method => {
    let birth = "old";
    const { core, transport } = await fixture({ birth: async () => birth });
    await hook(core, "flush-race");
    const peer = await shim(core, "flush-race");
    let entered: () => void = () => {};
    const flushing = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const flush = core.flush.bind(core);
    let pause = true;
    core.flush = async () => { if (pause) { pause = false; entered(); await held; } await flush(); };
    const pending = core.request(peer, method);
    const rejected = expect(pending).rejects.toThrow(/owner has changed/);
    await flushing;
    birth = "new";
    await hook(core, "flush-race");
    const reads = transport.calls.filter(call => call.method === "topic.list" || call.method === "inbox.list").length;
    release();
    await rejected;
    expect(transport.calls.filter(call => call.method === "topic.list" || call.method === "inbox.list")).toHaveLength(reads);
  });
  it.each(["whoami", "inbox.list", "hook.poll"])("rejects a stale %s result after a transport await", async method => {
    let birth = "old";
    const { core, transport } = await fixture({ birth: async () => birth });
    await hook(core, "result-race");
    const peer = await shim(core, "result-race");
    let entered: () => void = () => {};
    const reading = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let pause = true;
    transport.afterRequest = async name => {
      if (pause && (name === "topic.list" || name === "inbox.list")) { pause = false; entered(); await held; }
    };
    const pending = core.request(peer, method, method === "hook.poll" ? { event: "Stop" } : {});
    const rejected = expect(pending).rejects.toThrow(/owner has changed/);
    await reading;
    birth = "new";
    const successor = await hook(core, "result-race");
    release();
    await rejected;
    expect(Identity.parse(await core.request(successor.peer, "whoami")).session.state).toBe("active");
  });
  it("does not let a delayed dead-process sweep end its replacement", async () => {
    let birth = "old";
    let entered: () => void = () => {};
    const probing = new Promise<void>(resolve => { entered = resolve; });
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let pause = false;
    const { core } = await fixture({ alive: false, birth: async () => {
      if (pause) { pause = false; entered(); await held; return undefined; }
      return birth;
    } });
    await hook(core, "sweep-race");
    pause = true;
    const pending = core.sweep();
    await probing;
    birth = "new";
    const successor = await hook(core, "sweep-race");
    release();
    await pending;
    expect(Identity.parse(await core.request(successor.peer, "whoami")).session.state).toBe("active");
  });
  it("preserves a live hook-only Claude owner through repeated liveness sweeps", async () => {
    const { core, adapter } = await fixture({ alive: false });
    adapter.isAlive = claudeAdapter.isAlive;
    const first = await hook(core, "hook-only", { ppid: process.pid, endpoint: undefined });
    for (let attempt = 0; attempt < 3; attempt++) {
      await core.sweep();
      const repeat = await hook(core, "hook-only", { ppid: process.pid, endpoint: undefined });
      expect(repeat.session?.id).toBe(first.session?.id);
      expect(repeat.session?.incarnation).toBe(0);
      expect(Identity.parse(await core.request(first.peer, "whoami")).session.capability).toBe("hook");
    }
  });
  it("waits for hook registration when the exact shim arrives first", async () => {
    const { core } = await fixture();
    const waiting = await shim(core, "late");
    await expect(core.request(waiting, "whoami")).rejects.toThrow(/waiting for its hook/);
    const a = await hook(core, "late");
    expect(Identity.parse(await core.request(waiting, "whoami")).session.id).toBe(a.session?.id);
    expect(core.registry.all()).toHaveLength(1);
  });
  it("pins a fallback-bound shim after its original session ends instead of claiming another cwd match", async () => {
    const { core } = await fixture();
    const a = await hook(core, "a");
    const bound = await shim(core);
    expect(Identity.parse(await core.request(bound, "whoami")).session.id).toBe(a.session?.id);
    await core.request(a.peer, "session.gone", {});
    await hook(core, "b");
    await expect(core.request(bound, "whoami")).rejects.toThrow(/bound session has ended/);
    expect(bound.key).toBe("claude-code:a");
    core.registry.db.prepare("DELETE FROM sessions WHERE local_key=?").run("claude-code:a");
    await expect(core.request(bound, "session.list", {})).rejects.toThrow(/bound session has ended/);
    expect(bound.key).toBe("claude-code:a");
  });
  it("does not let shim choose session id, human origin, lifecycle or management authority", async () => {
    const { core } = await fixture();
    const { peer, session } = await hook(core, "a");
    await expect(core.request(core.peer(), "status")).rejects.toThrow(/ipc.hello/);
    await expect(core.request(peer, "session.list", { session_id: "another" })).rejects.toThrow(/assigned by agentd/);
    await expect(core.request(peer, "message.send", { message: { to: [session?.handle], body: "x", origin: "human" } })).rejects.toThrow(/human-origin/);
    await expect(core.request(peer, "session.upsert", { op: "reincarnate" })).rejects.toThrow(/lifecycle/);
    await expect(core.request(peer, "daemon.shutdown")).rejects.toThrow(/CLI/);
    await expect(core.request(peer, "session.upsert", { op: "update", session: { capability: "native" } })).rejects.toThrow();
  });
  it("promotes capability when hook supplies verified policy without reincarnating", async () => {
    const { core } = await fixture();
    const a = await hook(core, "a", { permission_mode: "bypassPermissions" });
    expect(a.session?.capability).toBe("hook");
    const b = await hook(core, "a", { inbound_policy: "accept" });
    expect(b.session?.id).toBe(a.session?.id);
    expect(b.session?.incarnation).toBe(0);
    expect(b.session?.capability).toBe("native");
    expect(JSON.stringify(core.status())).not.toContain("fake.sock");
  });
  it("preserves newer hook facts while an earlier registration ACK is in flight", async () => {
    const { core, transport } = await fixture();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => { entered = resolve; });
    transport.afterRequest = async (method) => { if (method === "session.upsert") { entered(); await held; } };
    const first = hook(core, "same", { permission_mode: "bypassPermissions", token: "old" });
    await inFlight;
    const second = hook(core, "same", { permission_mode: "bypassPermissions", token: "new", inbound_policy: "accept" });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(core.registry.all()[0]?.token).toBe("new");
    expect(core.registry.all()[0]?.session.capability).toBe("native");
  });
  it("clears accepted policy, mode, endpoint and token on revival before applying only current facts", async () => {
    const { core } = await fixture();
    const old = await hook(core, "same", { permission_mode: "bypassPermissions", inbound_policy: "accept", token: "old-launch-token" });
    expect(old.session?.capability).toBe("native");
    await core.request(old.peer, "session.gone", {});
    const peer = core.peer();
    const revived = HelloReply.parse(await core.request(peer, "ipc.hello", {
      client: "hook", protocol_version: PROTOCOL_VERSION, pid: 1000, ppid: 55,
      vendor: "claude-code", vendor_session_id: "same", cwd: "/repo",
    }));
    const record = core.registry.get("claude-code:same");
    expect(revived.session?.incarnation).toBe(1);
    expect(record?.permissionMode).toBeUndefined();
    expect(record?.inboundPolicy).toBeUndefined();
    expect(record?.endpoint).toBeUndefined();
    expect(record?.token).toBeUndefined();
    expect(record?.session.capability).toBe("hook");
  });
  it("resets launch facts when the observed process birth changes but preserves same-process late observations", async () => {
    let birth = "old-birth";
    const { core } = await fixture({ birth: async () => birth });
    await hook(core, "same", { permission_mode: "bypassPermissions", inbound_policy: "accept", token: "old-launch-token" });
    const late = core.peer();
    await core.request(late, "ipc.hello", { client: "hook", protocol_version: PROTOCOL_VERSION, pid: 1001, ppid: 55, vendor: "claude-code", vendor_session_id: "same", cwd: "/repo" });
    expect(core.registry.get("claude-code:same")?.inboundPolicy).toBe("accept");
    expect(core.registry.get("claude-code:same")?.token).toBe("old-launch-token");
    expect(core.registry.get("claude-code:same")?.session.incarnation).toBe(0);
    birth = "new-birth";
    const next = await hook(core, "same", { permission_mode: "bypassPermissions" });
    const record = core.registry.get("claude-code:same");
    expect(next.session?.incarnation).toBe(1);
    expect(record?.processStartedAt).toBe("new-birth");
    expect(record?.permissionMode).toBe("bypassPermissions");
    expect(record?.inboundPolicy).toBeUndefined();
    expect(record?.token).toBeUndefined();
    expect(record?.session.capability).toBe("hook");
  });
});

describe("durable replay and recovery", () => {
  it("replays first-ever offline registrations, send and SessionEnd in dependency order", async () => {
    const { core, transport } = await fixture({ online: false });
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    expect(a.session).toBeUndefined();
    expect(b.session).toBeUndefined();
    const recipient = core.registry.get("claude-code:b");
    if (!recipient) throw new Error("missing provisional recipient");
    const queued = await send(core, a.peer, `${recipient.session.name}@mac`, "offline before registration");
    expect(queued.status).toBe("queued");
    await core.request(a.peer, "session.gone", {});
    expect(core.registry.outbox().map((entry) => entry.method)).toEqual([
      "session.upsert", "session.upsert", "message.send", "session.gone",
    ]);
    await transport.reconnect();
    expect(transport.calls.map((call) => call.method)).toEqual([
      "session.upsert", "session.upsert", "message.send", "session.gone", "deliveries.resync",
    ]);
    expect(core.registry.outbox()).toHaveLength(0);
    expect(core.registry.get("claude-code:a")?.session.state).toBe("gone");
    const inbox = Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", { unread_only: true }));
    expect(inbox.headers).toHaveLength(1);
    transport.disconnect();
    await transport.reconnect();
    expect(Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", {})).headers).toHaveLength(1);
  });
  it("reincarnates a first-ever offline session revived before the initial hub id is known", async () => {
    const { core, transport } = await fixture({ online: false });
    const first = await hook(core, "a");
    await core.request(first.peer, "session.gone", {});
    const revived = await hook(core, "a");
    expect(revived.session).toBeUndefined();
    const operations = core.registry.outbox().filter((entry) => entry.method === "session.upsert").map((entry) => z.object({ op: z.string() }).parse(JSON.parse(entry.params)).op);
    expect(operations).toEqual(["register", "reincarnate"]);
    await transport.reconnect();
    const identity = Identity.parse(await core.request(revived.peer, "whoami"));
    expect(identity.session.incarnation).toBe(1);
    expect(identity.session.state).toBe("active");
    expect(Results["session.list"].parse(await core.request(revived.peer, "session.list", {})).sessions[0]?.state).toBe("active");
    expect(core.registry.outbox()).toHaveLength(0);
  });
  it("resolves gone against the preceding pending reincarnation, including a lost lifecycle ACK", async () => {
    const { core, transport } = await fixture();
    const first = await hook(core, "a");
    const observer = await hook(core, "observer");
    transport.disconnect();
    await core.request(first.peer, "session.gone", {});
    const revived = await hook(core, "a");
    await core.request(revived.peer, "session.gone", {});
    const pendingGone = core.registry.outbox().filter((entry) => entry.method === "session.gone").at(-1);
    expect(pendingGone && z.object({ after_reg_id: z.string() }).parse(JSON.parse(pendingGone.params)).after_reg_id).toBeDefined();
    transport.loseAck = "session.upsert";
    await expect(transport.reconnect()).rejects.toThrow(/unavailable/);
    const pendingLifecycle = core.registry.outbox().find((entry) => entry.method === "session.upsert");
    expect(pendingLifecycle).toBeDefined();
    await transport.reconnect();
    const sessions = Results["session.list"].parse(await core.request(observer.peer, "session.list", {})).sessions;
    const ended = sessions.find((session) => session.id === first.session?.id);
    expect(ended?.incarnation).toBe(1);
    expect(ended?.state).toBe("gone");
    expect(core.registry.outbox()).toHaveLength(0);
    const goneCalls = transport.calls.filter((call) => call.method === "session.gone").map((call) => z.object({ incarnation: z.number() }).parse(call.params).incarnation);
    expect(goneCalls).toEqual([0, 1]);
  });
  it("keeps an older gone epoch immutable when a subsequent revival is already queued", async () => {
    const { core, transport } = await fixture();
    const first = await hook(core, "a");
    transport.disconnect();
    await core.request(first.peer, "session.gone", {});
    const second = await hook(core, "a");
    await core.request(second.peer, "session.gone", {});
    const third = await hook(core, "a");
    await transport.reconnect();
    const identity = Identity.parse(await core.request(third.peer, "whoami"));
    expect(identity.session.incarnation).toBe(2);
    expect(identity.session.state).toBe("active");
    const goneCalls = transport.calls.filter((call) => call.method === "session.gone").map((call) => z.object({ incarnation: z.number() }).parse(call.params).incarnation);
    expect(goneCalls).toEqual([0, 1]);
    // The first epoch's delayed replay must not end the now-live second reincarnation.
    await transport.request("session.gone", { session_id: identity.session.id, incarnation: goneCalls[0] });
    expect(Results["session.list"].parse(await core.request(third.peer, "session.list", {})).sessions[0]?.state).toBe("active");
  });
  it("queues offline sends and delivers once after reconnect, including lost acknowledgement", async () => {
    const { core, transport } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    transport.disconnect();
    const queued = await send(core, a.peer, b.session?.handle ?? "missing");
    expect(queued.status).toBe("queued");
    await transport.reconnect();
    const inbox = Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", { unread_only: true }));
    expect(inbox.headers).toHaveLength(1);
    transport.loseAck = "message.send";
    expect((await send(core, a.peer, b.session?.handle ?? "missing", "lost ack")).status).toBe("queued");
    await transport.reconnect();
    expect(Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", {})).headers).toHaveLength(2);
    expect(core.registry.outbox()).toHaveLength(0);
  });
  it("resync recovers a dropped delivery and never repeats an already attempted sequence", async () => {
    const { core, transport, clock, attempts } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    transport.dropDeliver = true;
    await send(core, a.peer, b.session?.handle ?? "missing");
    await clock.advance(0);
    expect(attempts).toHaveLength(0);
    transport.dropDeliver = false;
    transport.disconnect();
    await transport.reconnect();
    await clock.advance(0);
    expect(attempts).toHaveLength(1);
    transport.disconnect();
    await transport.reconnect();
    await clock.advance(30_000);
    expect(attempts).toHaveLength(1);
    expect(Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", { unread_only: true })).headers).toHaveLength(1);
  });
  it("retains registration and reincarnation replay keys across repeated daemon restart", async () => {
    const home = await mkdtemp(join(tmpdir(), "kom-registry-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));
    const dbPath = join(home, "state.db");
    const first = await fixture({ dbPath });
    first.transport.loseAck = "session.upsert";
    await hook(first.core, "a");
    const reg = first.core.registry.outbox()[0]?.params;
    await first.close();
    const second = await fixture({ dbPath, hub: first.hub, online: false });
    expect(second.core.registry.outbox()[0]?.params).toBe(reg);
    await second.transport.reconnect();
    expect(second.core.registry.all()[0]?.session.incarnation).toBe(0);
    await second.close();
    const third = await fixture({ dbPath, hub: first.hub, online: false });
    const reincarnate = third.core.registry.outbox()[0]?.params;
    await third.close();
    const fourth = await fixture({ dbPath, hub: first.hub, online: false });
    expect(fourth.core.registry.outbox()).toHaveLength(1);
    expect(fourth.core.registry.outbox()[0]?.params).toBe(reincarnate);
    await fourth.transport.reconnect();
    expect(fourth.core.registry.all()[0]?.session.incarnation).toBe(1);
  });
  it("blocks replay beyond seven days and exposes a sanitized actionable status", async () => {
    const { core, transport, clock } = await fixture();
    const a = await hook(core, "a", { token: "sensitive-local-token" });
    transport.disconnect();
    await send(core, a.peer, a.session?.handle ?? "missing");
    clock.time = 8 * 24 * 60 * 60 * 1000;
    await transport.reconnect();
    expect(core.status().outbox[0]?.error).toMatch(/replay horizon/);
    expect(JSON.stringify(core.status())).not.toContain("sensitive-local-token");
    expect(Results["inbox.list"].parse(await core.request(a.peer, "inbox.list", {})).headers).toHaveLength(0);
  });
  it("detects PID reuse by process start time even when adapter existence succeeds", async () => {
    let birth = "original";
    const { core } = await fixture({ alive: false, birth: async () => birth });
    await hook(core, "a");
    birth = "reused";
    await core.sweep();
    expect(core.registry.all()[0]?.session.state).toBe("gone");
  });
  it("does not let a failed lifecycle or expired replay unblock dependent commands later", async () => {
    const { core, transport, clock } = await fixture();
    const a = await hook(core, "a");
    transport.disconnect();
    await send(core, a.peer, a.session?.handle ?? "missing", "expired");
    clock.time = 8 * 24 * 60 * 60 * 1000;
    await send(core, a.peer, a.session?.handle ?? "missing", "dependent");
    await transport.reconnect();
    await core.flush();
    expect(core.registry.outbox()).toHaveLength(2);
    expect(Results["inbox.list"].parse(await core.request(a.peer, "inbox.list", {})).headers).toHaveLength(0);
  });
});

describe("wake and receipt boundaries", () => {
  it("coalesces t10/t20 into one trailing wake at t30 and leaves written receipts unread", async () => {
    const { core, clock, attempts } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    await send(core, a.peer, b.session?.handle ?? "missing", "t0");
    await clock.advance(0);
    await clock.advance(10_000);
    await send(core, a.peer, b.session?.handle ?? "missing", "t10");
    await clock.advance(10_000);
    await send(core, a.peer, b.session?.handle ?? "missing", "t20");
    expect(attempts).toHaveLength(1);
    await clock.advance(10_000);
    expect(attempts.map((attempt) => attempt.at)).toEqual([0, 30_000]);
    expect(Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", { unread_only: true })).headers).toHaveLength(3);
  });
  it("cancels trailing native delivery after ack or current DND", async () => {
    const { core, clock, attempts } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    await send(core, a.peer, b.session?.handle ?? "missing");
    await clock.advance(0);
    await clock.advance(10_000);
    const later = await send(core, a.peer, b.session?.handle ?? "missing");
    if (later.status !== "sent") throw new Error("expected sent");
    await core.request(b.peer, "hook.ack", { ids: [later.id] });
    await clock.advance(20_000);
    expect(attempts).toHaveLength(1);
    await send(core, a.peer, b.session?.handle ?? "missing");
    await core.request(await cli(core), "session.dnd", { wake: "off", session: b.session?.id });
    await clock.advance(30_000);
    expect(attempts).toHaveLength(1);
  });
  it("Stop blocks once, ignores reentry and FYI, and resets only on a human prompt", async () => {
    const { core } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    await send(core, a.peer, b.session?.handle ?? "missing");
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop" })).block).toBe(true);
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop" })).block).toBe(false);
    expect(core.registry.byId(b.session?.id ?? "")?.session.state).toBe("idle");
    await core.request(b.peer, "hook.poll", { event: "PostToolUse" });
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop" })).block).toBe(false);
    await core.request(b.peer, "hook.poll", { event: "UserPromptSubmit" });
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop", stop_hook_active: true })).block).toBe(false);
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop" })).block).toBe(true);
    const inbox = Results["inbox.list"].parse(await core.request(b.peer, "inbox.list", {}));
    await core.request(b.peer, "hook.ack", { ids: inbox.headers.map((header) => header.id) });
    await core.request(a.peer, "message.send", { message: { to: [b.session?.handle], body: "FYI", priority: "fyi" } });
    await core.request(b.peer, "hook.poll", { event: "UserPromptSubmit" });
    expect(PollReply.parse(await core.request(b.peer, "hook.poll", { event: "Stop" })).block).toBe(false);
  });
  it("preserves DND changed while a native attempt is waiting on its socket", async () => {
    const { core, clock, adapter } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    adapter.deliver = async () => { await held; return { outcome: "written" }; };
    await send(core, a.peer, b.session?.handle ?? "missing");
    await clock.advance(0);
    await core.request(await cli(core), "session.dnd", { wake: "off", session: b.session?.id });
    release();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(core.registry.byId(b.session?.id ?? "")?.session.wake).toBe("off");
  });
  it("keeps failed lower sequences recoverable when a later delivery is acknowledged", async () => {
    const { core, transport, clock, adapter, attempts } = await fixture();
    const a = await hook(core, "a");
    const b = await hook(core, "b");
    const original = adapter.deliver;
    adapter.deliver = async () => { throw new Error("temporary adapter failure"); };
    const first = await send(core, a.peer, b.session?.handle ?? "missing");
    await clock.advance(0);
    const second = await send(core, a.peer, b.session?.handle ?? "missing");
    if (second.status !== "sent") throw new Error("expected sent");
    await core.request(b.peer, "hook.ack", { ids: [second.id] });
    expect(core.registry.byId(b.session?.id ?? "")?.acked).toBe(0);
    adapter.deliver = original;
    transport.disconnect();
    await transport.reconnect();
    await clock.advance(0);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.id).toBe(first.status === "sent" ? first.id : "missing");
  });
  it("restores a pending trailing wake after restart without replaying its first wake", async () => {
    const home = await mkdtemp(join(tmpdir(), "kom-trailing-"));
    cleanup.push(async () => rm(home, { recursive: true, force: true }));
    const clock = new ManualClock();
    const dbPath = join(home, "state.db");
    const first = await fixture({ dbPath, clock });
    const a = await hook(first.core, "a");
    const b = await hook(first.core, "b");
    await send(first.core, a.peer, b.session?.handle ?? "missing", "t0");
    await clock.advance(0);
    await clock.advance(10_000);
    await send(first.core, a.peer, b.session?.handle ?? "missing", "t10");
    await first.close();
    const restarted = await fixture({ dbPath, clock, hub: first.hub });
    await clock.advance(19_999);
    expect(restarted.attempts).toHaveLength(0);
    await clock.advance(1);
    expect(restarted.attempts.map((attempt) => attempt.at)).toEqual([30_000]);
  });
});


describe("Codex root lifecycle", () => {
  it("registers two same-cwd roots from shims and does not replace liveness or revive from hooks", async () => {
    const { core } = await fixture();
    const hello = (id: string, client: "shim" | "hook", pid: number) => ({ protocol_version: PROTOCOL_VERSION, vendor: "codex", vendor_session_id: id, client, pid, ppid: 999, cwd: "/same/repo" });
    const early = core.peer();
    await expect(core.request(early, "ipc.hello", hello("a", "hook", 40))).rejects.toThrow();
    expect(core.registry.all()).toHaveLength(0);
    const a = core.peer(); const b = core.peer();
    await core.request(a, "ipc.hello", hello("a", "shim", 10));
    await core.request(b, "ipc.hello", hello("b", "shim", 20));
    const first = Identity.parse(await core.request(a, "whoami"));
    const second = Identity.parse(await core.request(b, "whoami"));
    expect(first.session.id).not.toBe(second.session.id);
    const hook = core.peer(); await core.request(hook, "ipc.hello", hello("a", "hook", 50));
    expect(core.registry.get("codex:a")?.pid).toBe(10);
    expect(Identity.parse(await core.request(hook, "whoami")).session.incarnation).toBe(first.session.incarnation);
    await core.request(hook, "hook.poll", { event: "PostToolUse" });
    await core.request(hook, "hook.poll", { event: "Stop" });
    const diagnostics = await core.request(await cli(core), "daemon.diagnostics");
    expect(diagnostics).toMatchObject({ codex_sessions: expect.arrayContaining([{ id: first.session.id, shim_alive: true, hook_events: ["PostToolUse", "Stop"] }]) });
    await core.request(hook, "session.gone");
    await expect(core.request(a, "whoami")).rejects.toThrow("bound session has ended");
    await expect(core.request(core.peer(), "ipc.hello", hello("a", "hook", 60))).rejects.toThrow();
    expect(Identity.parse(await core.request(b, "whoami")).session.id).toBe(second.session.id);
    await expect(core.request(core.peer(), "ipc.hello", { client: "shim", pid: 30, vendor: "codex", protocol_version: PROTOCOL_VERSION, cwd: "/same/repo" })).rejects.toThrow("vendor_session_id");
  });
});
