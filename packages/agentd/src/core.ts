import { RELEASE_VERSION } from "@kommutator/protocol";
import { randomUUID, createHash } from "node:crypto";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import * as z from "zod";
import { Methods, Notifications, Results, RegisteredSession, Session, Message, PROTOCOL_VERSION, toIdent, type MethodName } from "@kommutator/protocol";
import { claudeAdapter, claudeCapability } from "./adapters/claude.js";
import { codexAdapter } from "./adapters/codex.js";
import { genericAdapter } from "./adapters/generic.js";
import type { Adapter } from "./adapters/types.js";
import { resolveBinding } from "./binding.js";
import type { DaemonConfig } from "./config.js";
import { OfflineError, RpcError } from "./errors.js";
import type { HubTransport } from "./hub-link.js";
import { Registry, processStart, type LocalRecord, type Delivery, type OutboxEntry } from "./registry.js";
import { realClock, WakeScheduler, type Clock } from "./wake.js";
import { Projects } from "./project.js";

export type Hello = z.infer<(typeof Methods)["ipc.hello"]>;
export interface IpcPeer { hello?: Hello; key?: string }
export interface CoreOptions {
  config: DaemonConfig;
  dbPath: string;
  transport: HubTransport;
  adapters?: Adapter[];
  clock?: Clock;
  processStart?: (pid: number) => Promise<string | undefined>;
  isAlive?: (record: LocalRecord) => Promise<boolean>;
  onError?: (message: string) => void;
  onShutdown?: () => void;
  project?: string;
}
const ObjectParams = z.record(z.string(), z.unknown());
const Poll = z.object({ event: z.enum(["PostToolUse", "UserPromptSubmit", "Stop"]), stop_hook_active: z.boolean().optional() });
const REPLAY_HORIZON = 7 * 24 * 60 * 60 * 1000;
const READ_METHODS = new Set(["session.list", "inbox.list", "message.read", "topic.list", "board.get", "board.history"]);
const WRITE_METHODS = new Set(["message.send", "board.put", "receipt.mark", "topic.join", "topic.leave", "session.upsert", "session.gone", "session.heartbeat"]);

export class DaemonCore {
  readonly registry: Registry;
  readonly transport: HubTransport;
  readonly config: DaemonConfig;
  readonly clock: Clock;
  readonly wake: WakeScheduler;
  lastError: string | undefined;
  private lastErrorAt: number | undefined;
  private readonly adapters: Map<Session["vendor"], Adapter>;
  private readonly peers = new Set<IpcPeer>();
  private flushing: Promise<void> | undefined;
  private readonly outcomes = new Map<number, { result?: unknown; error?: RpcError }>();
  private readonly deliveryRuns = new Map<string, Promise<void>>();
  private closed = false;
  private readonly codexHookEvents = new Map<string, Set<string>>();
  private readonly projects = new Projects();

  constructor(private readonly options: CoreOptions) {
    this.registry = new Registry(options.dbPath);
    this.transport = options.transport;
    this.config = options.config;
    this.clock = options.clock ?? realClock;
    this.adapters = new Map((options.adapters ?? [claudeAdapter, codexAdapter, genericAdapter]).map((adapter) => [adapter.vendor, adapter]));
    this.wake = new WakeScheduler(this.clock, async (key) => {
      try { await this.deliverPending(key); }
      catch { this.report("native delivery attempt failed; unread delivery retained"); }
    });
  }

  report(message: string): void { this.lastError = message; this.lastErrorAt = this.clock.now(); this.options.onError?.(message); }
  peer(): IpcPeer { const peer: IpcPeer = {}; this.peers.add(peer); return peer; }
  disconnect(peer: IpcPeer): void { this.peers.delete(peer); }

  async start(): Promise<void> {
    for (const record of this.registry.all()) {
      if (record.session.state === "gone") continue;
      if (!await this.alive(record)) { this.markGone(record); continue; }
      if (record.session.id && !this.registrationPending(record.key)) this.queueReincarnate(record);
    }
    this.transport.start(async () => { await this.synchronize(); }, (method, params) => {
      if (method === "deliver") {
        const delivery = Notifications.deliver.parse(params);
        const record = this.registry.byId(delivery.session_id);
        if (!record || record.session.state === "gone") return;
        const fresh = this.registry.receive(delivery);
        if (fresh && delivery.wake && record.session.wake === "on") this.wake.schedule(record.key, record.lastWake);
      } else if (method === "config") this.wake.cooldown = Notifications.config.parse(params).coalesce_ms;
    });
  }

  async synchronize(): Promise<void> {
    await this.flush();
    const live = this.registry.all().filter((record) => record.session.id && record.session.state !== "gone");
    await this.transport.request("deliveries.resync", { acked: Object.fromEntries(live.map((record) => [record.session.id, record.acked])) });
    for (const record of live) {
      if (this.registry.pending(record.session.id ?? "").some((delivery) => delivery.wake)) this.wake.schedule(record.key, record.lastWake);
    }
  }

  private adapter(record: LocalRecord): Adapter { return this.adapters.get(record.session.vendor) ?? genericAdapter; }
  private async alive(record: LocalRecord): Promise<boolean> {
    if (this.options.isAlive) return this.options.isAlive(record);
    if (!record.pid || !record.processStartedAt) return false;
    if (await (this.options.processStart ?? processStart)(record.pid) !== record.processStartedAt) return false;
    return this.adapter(record).isAlive(record);
  }
  private registrationPending(key: string): boolean {
    return this.registry.outbox().some((entry) => entry.local_key === key && entry.method === "session.upsert" &&
      ["register", "reincarnate"].includes(ObjectParams.parse(JSON.parse(entry.params))["op"] as string));
  }
  private queueReincarnate(record: LocalRecord): void {
    this.registry.enqueue(record.key, "session.upsert", { op: "reincarnate", session: record.session, reg_id: randomUUID() }, this.clock.now());
  }
  private markGone(record: LocalRecord): void {
    this.codexHookEvents.delete(record.key);
    record.session.state = "gone";
    this.registry.transaction(() => {
      const lifecycle = this.registry.outbox().filter((entry) => entry.local_key === record.key && entry.method === "session.upsert")
        .map((entry) => ObjectParams.parse(JSON.parse(entry.params)))
        .filter((params) => params["op"] === "register" || params["op"] === "reincarnate").at(-1);
      this.registry.save(record);
      this.registry.enqueue(record.key, "session.gone", {
        incarnation: record.session.incarnation,
        // Local dependency only. The lifecycle ACK fixes the actual epoch before send.
        ...(lifecycle ? { after_reg_id: lifecycle["reg_id"] } : {}),
      }, this.clock.now());
    });
  }

  async sweep(): Promise<void> {
    for (const record of this.registry.all()) {
      if (record.session.state === "gone") continue;
      if (!await this.alive(record)) this.markGone(record);
      else if (this.transport.connected && record.session.id) {
        try { await this.transport.request("session.heartbeat", { session_id: record.session.id, state: record.session.state }); }
        catch { this.report("session heartbeat failed"); }
      }
    }
    await this.flush();
  }

  private async register(hello: Hello, human = false): Promise<LocalRecord> {
    const vendor = human ? "other" : hello.vendor ?? "other";
    const vendorId = human ? `human:${createHash("sha256").update(hello.cwd ?? "").digest("hex").slice(0, 24)}` : hello.vendor_session_id;
    const key = vendorId ? `${vendor}:${vendorId}` : `shim:${hello.pid}`;
    const pid = hello.client === "hook" ? hello.ppid : hello.pid;
    const birth = pid ? await (this.options.processStart ?? processStart)(pid) : undefined;
    const project = hello.cwd ? await this.projects.key(hello.cwd, this.options.project ?? hello.project_key) : undefined;
    const existing = this.registry.get(key);
    const record: LocalRecord = existing ?? {
      key, acked: 0, stopBlocked: false,
      session: Session.parse({
        host: this.config.host, name: human ? "human" : toIdent(`${vendor}-${basename(hello.cwd ?? "session")}-${this.registry.all().length + 1}`),
        vendor, ...(vendorId ? { vendor_session_id: vendorId } : {}),
        ...(hello.cwd ? { cwd: hello.cwd, project_key: project } : {}),
        capability: vendor === "other" ? "none" : "hook",
      }),
    };
    const wasGone = record.session.state === "gone";
    const launchChanged = Boolean(existing && (
      (pid !== undefined && record.pid !== undefined && pid !== record.pid) ||
      (birth !== undefined && record.processStartedAt !== undefined && birth !== record.processStartedAt) ||
      (hello.endpoint !== undefined && record.endpoint !== undefined && hello.endpoint !== record.endpoint)
    ));
    if (wasGone || launchChanged) {
      this.codexHookEvents.delete(key);
      delete record.pid;
      delete record.processStartedAt;
      delete record.endpoint;
      delete record.token;
      delete record.permissionMode;
      delete record.inboundPolicy;
      record.stopBlocked = false;
    }
    if (pid) record.pid = pid;
    if (birth) record.processStartedAt = birth;
    if (hello.endpoint !== undefined) record.endpoint = hello.endpoint;
    if (hello.token !== undefined) record.token = hello.token;
    if (hello.permission_mode !== undefined) record.permissionMode = hello.permission_mode;
    if (hello.inbound_policy !== undefined) record.inboundPolicy = hello.inbound_policy;
    const previousCapability = record.session.capability;
    record.session.capability = vendor === "claude-code" ? claudeCapability(record) : this.adapter(record).capability;
    record.session.state = "active";
    this.registry.transaction(() => {
      this.registry.save(record);
      if (!existing) {
        const { id: _id, incarnation: _incarnation, ...session } = record.session;
        this.registry.enqueue(key, "session.upsert", { op: "register", session, reg_id: randomUUID() }, this.clock.now());
      } else if (wasGone || launchChanged) this.queueReincarnate(record);
      if (existing && previousCapability !== record.session.capability) {
        this.registry.enqueue(key, "session.upsert", { op: "update", session: { capability: record.session.capability } }, this.clock.now());
      }
    });
    return record;
  }

  private bind(peer: IpcPeer): LocalRecord {
    if (!peer.hello || peer.hello.client === "cli") throw new RpcError(-32020, "session requires ipc.hello from its shim or hook");
    if (peer.key !== undefined) {
      const cached = this.registry.get(peer.key);
      if (!cached || cached.session.state === "gone") throw new RpcError(-32020, "bound session has ended or is unavailable; open a new connection");
      return cached;
    }
    const bound = new Set([...this.peers].filter((candidate) => candidate !== peer && candidate.hello?.client === "shim").flatMap((candidate) => candidate.key ? [candidate.key] : []));
    const record = resolveBinding(peer.hello, this.registry.all(), bound);
    peer.key = record.key;
    return record;
  }

  async request(peer: IpcPeer, method: string, value: unknown = {}): Promise<unknown> {
    if (this.closed) throw new OfflineError("daemon is stopping");
    if (method === "ipc.hello") {
      if (peer.hello) throw new RpcError(-32600, "ipc.hello may only be sent once per connection");
      const parsed = Methods["ipc.hello"].safeParse(value);
      if (!parsed.success) throw new RpcError(-32602, "invalid ipc.hello parameters");
      peer.hello = parsed.data;
      if (parsed.data.protocol_version !== PROTOCOL_VERSION) this.report("IPC protocol version differs from daemon");
      if (parsed.data.client === "cli") return { bound: false };
      if (parsed.data.vendor === "codex") {
        if (!parsed.data.vendor_session_id) throw new RpcError(-32602, "Codex requires an explicit vendor_session_id");
        if (parsed.data.client === "shim") {
          const record = await this.register(parsed.data);
          peer.key = record.key;
        } else {
          // Hooks have no stable PID. Only the MCP shim may create or revive a root.
          this.bind(peer);
        }
      } else if (parsed.data.client === "hook") {
        if (!parsed.data.vendor_session_id) throw new RpcError(-32602, "hook requires vendor_session_id");
        const record = await this.register(parsed.data);
        peer.key = record.key;
      } else if (!parsed.data.vendor_session_id && (!parsed.data.vendor || parsed.data.vendor === "other")) {
        const record = await this.register(parsed.data);
        peer.key = record.key;
      } else {
        try { this.bind(peer); } catch (error) { if (!(error instanceof RpcError)) throw error; }
      }
      await this.flush();
      const record = peer.key ? this.registry.get(peer.key) : undefined;
      return record?.session.id ? { bound: true, session: record.session } : { bound: Boolean(record), pending: true };
    }
    if (!peer.hello) throw new RpcError(-32020, "ipc.hello is required before requests");
    if (method === "daemon.status" || method === "status") return this.status();
    if (method === "daemon.diagnostics") {
      this.requireCli(peer);
      const sessions = await Promise.all(this.registry.all()
        .filter((record) => record.session.id && record.session.vendor === "claude-code" && record.session.state !== "gone")
        .map(async (record) => {
          let socketPresent: boolean | null = null;
          if (record.endpoint) {
            try { socketPresent = (await stat(record.endpoint)).isSocket(); }
            catch (error) {
              if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) socketPresent = false;
            }
          }
          return { id: record.session.id, endpoint_configured: Boolean(record.endpoint), socket_present: socketPresent };
        }));
      const codex = await Promise.all(this.registry.all()
        .filter((record) => record.session.vendor === "codex" && record.session.id && record.session.state !== "gone")
        .map(async (record) => ({ id: record.session.id, shim_alive: await this.alive(record), hook_events: [...(this.codexHookEvents.get(record.key) ?? [])] })));
      return { claude_sessions: sessions, codex_sessions: codex };
    }
    if (method === "daemon.shutdown") {
      this.requireCli(peer);
      this.options.onShutdown?.();
      return { ok: true };
    }
    if (method === "session.dnd") {
      this.requireCli(peer);
      const params = z.object({ wake: z.enum(["on", "off"]), session: z.string().optional() }).parse(value);
      const targets = this.registry.all().filter((record) => record.session.state !== "gone" && (!params.session || params.session === record.session.id || params.session === record.session.handle));
      if (params.session && !targets.length) throw new RpcError(-32004, "local session was not found");
      for (const record of targets) {
        record.session.wake = params.wake;
        this.registry.transaction(() => {
          this.registry.save(record);
          this.registry.enqueue(record.key, "session.upsert", { op: "update", session: { wake: params.wake } }, this.clock.now());
        });
      }
      await this.flush();
      return { ok: true, sessions: targets.length };
    }
    if (method === "human.send") {
      this.requireCli(peer);
      const params = z.object({ message: Message.omit({ from: true }).extend({ from: z.string().optional() }) }).parse(value);
      const record = await this.register(peer.hello, true);
      return this.send(record, { ...params.message, from: "", force_wake: params.message.origin === "human" && params.message.force_wake });
    }
    const record = this.bind(peer);
    if (method === "whoami") {
      await this.flush();
      const current = this.registry.get(record.key) ?? record;
      if (!current.session.id) throw new RpcError(-32021, "session registration is pending hub connectivity");
      const topics = Results["topic.list"].parse(await this.transport.request("topic.list", { session_id: current.session.id }));
      return { session: RegisteredSession.parse(current.session), topics: topics.topics };
    }
    if (method === "hook.poll") {
      const event = Poll.parse(value).event;
      const result = await this.poll(record, value);
      if (record.session.vendor === "codex" && peer.hello.client === "hook") {
        const events = this.codexHookEvents.get(record.key) ?? new Set<string>();
        events.add(event); this.codexHookEvents.set(record.key, events);
      }
      return result;
    }
    if (method === "hook.ack") {
      const params = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(value);
      return this.write(record, "receipt.mark", { ids: params.ids, state: "read" });
    }
    const params = ObjectParams.parse(value);
    // Callers cannot choose local identity, authorship, replay keys or lifecycle epochs.
    if ("session_id" in params || "idempotency_key" in params || "op_id" in params || "reg_id" in params) throw new RpcError(-32602, "caller identity and replay keys are assigned by agentd");
    if (method === "message.send") {
      const message = Message.parse({ ...ObjectParams.parse(params["message"]), from: "" });
      if (message.origin !== "agent" || message.force_wake) throw new RpcError(-32602, "agent sessions cannot send human-origin or force-wake messages");
      return this.send(record, message);
    }
    if (method === "session.upsert") {
      if (params["op"] !== "update") throw new RpcError(-32602, "registration lifecycle is managed by agentd");
      const update = z.object({ name: z.string().optional(), role: z.string().optional(), status_line: z.string().optional(), wake: z.enum(["on", "off"]).optional() }).strict().parse(params["session"]);
      if (update.wake) { record.session.wake = update.wake; this.registry.save(record); }
      return this.write(record, method, { op: "update", session: update });
    }
    if (method === "session.gone") {
      this.markGone(record);
      void this.flush();
      return { ok: true };
    }
    if (READ_METHODS.has(method)) {
      await this.flush();
      const current = this.registry.get(record.key) ?? record;
      if (!current.session.id) throw new RpcError(-32021, "session registration is pending");
      const parsed = this.validate(method, { ...params, session_id: current.session.id });
      const response = await this.transport.request(method, parsed);
      if (method === "message.read") {
        const body = Results["message.read"].parse(response);
        this.markActedIds(current, [body.message.id]);
      }
      return response;
    }
    if (WRITE_METHODS.has(method)) return this.write(record, method, params);
    throw new RpcError(-32601, "unknown or unavailable IPC method");
  }

  private requireCli(peer: IpcPeer): void { if (peer.hello?.client !== "cli") throw new RpcError(-32003, "method requires CLI connection"); }
  private validate(method: string, params: unknown): unknown {
    const schema = Methods[method as MethodName];
    if (!schema) throw new RpcError(-32601, "unknown hub method");
    const parsed = schema.safeParse(params);
    if (!parsed.success) throw new RpcError(-32602, "invalid method parameters");
    return parsed.data;
  }
  private async send(record: LocalRecord, message: Message): Promise<unknown> {
    const key = randomUUID();
    const id = this.registry.enqueue(record.key, "message.send", { message, idempotency_key: key }, this.clock.now());
    await this.flush();
    const outcome = this.outcomes.get(id);
    this.outcomes.delete(id);
    if (outcome?.error) throw outcome.error;
    if (outcome?.result) return { status: "sent", ...Results["message.send"].parse(outcome.result) };
    return { status: "queued", idempotency_key: key, outbox_depth: this.registry.outbox().length };
  }
  private async write(record: LocalRecord, method: string, params: Record<string, unknown>): Promise<unknown> {
    const stamped: Record<string, unknown> = { ...params, ...(method === "board.put" ? { op_id: randomUUID() } : {}) };
    // Validate even while offline, using a temporary id solely for schema validation.
    const validation = method === "session.upsert"
      ? { ...stamped, session: { ...ObjectParams.parse(stamped["session"]), id: record.session.id ?? "pending" } }
      : { ...stamped, session_id: record.session.id ?? "pending" };
    this.validate(method, validation);
    const id = this.registry.enqueue(record.key, method, stamped, this.clock.now());
    if (method === "receipt.mark" && params["state"] === "read") this.markActedIds(record, z.array(z.string()).parse(params["ids"]));
    await this.flush();
    const outcome = this.outcomes.get(id);
    this.outcomes.delete(id);
    if (outcome?.error) throw outcome.error;
    return outcome?.result ?? { status: "queued", outbox_id: id, outbox_depth: this.registry.outbox().length };
  }
  private effectiveParams(entry: OutboxEntry, record: LocalRecord): unknown {
    const params = ObjectParams.parse(JSON.parse(entry.params));
    if (entry.method === "session.upsert") {
      if (params["op"] === "register") return params;
      return { ...params, session: { ...ObjectParams.parse(params["session"]), id: record.session.id } };
    }
    return { ...params, session_id: record.session.id };
  }
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushQueue();
    try { await this.flushing; } finally { this.flushing = undefined; }
  }
  private async flushQueue(): Promise<void> {
    if (!this.transport.connected) return;
    for (;;) {
      let progressed = false;
      const blocked = new Set<string>();
      for (const queued of this.registry.outbox()) {
        const entry = this.registry.outboxEntry(queued.id);
        if (!entry) continue;
        if (blocked.has(entry.local_key)) continue;
        if (entry.error) {
          if (entry.method === "session.upsert" || entry.error.startsWith("replay horizon")) blocked.add(entry.local_key);
          continue;
        }
        const record = this.registry.get(entry.local_key);
        if (!record) { this.registry.fail(entry.id, "local session is missing"); continue; }
        if (this.clock.now() - entry.created_at > REPLAY_HORIZON) {
          this.registry.fail(entry.id, "replay horizon exceeded (7 days); manual intervention required");
          this.report("outbox entry exceeded the seven-day replay horizon");
          blocked.add(entry.local_key);
          continue;
        }
        const params = this.effectiveParams(entry, record);
        if (entry.method === "session.gone" && "after_reg_id" in ObjectParams.parse(params)) { blocked.add(entry.local_key); continue; }
        if (!record.session.id && !(entry.method === "session.upsert" && ObjectParams.parse(params)["op"] === "register")) { blocked.add(entry.local_key); continue; }
        try {
          const result = await this.transport.request(entry.method, this.validate(entry.method, params));
          this.registry.transaction(() => {
            if (entry.method === "session.upsert") {
              const updated = Results["session.upsert"].parse(result).session;
              const lifecycle = ObjectParams.parse(params);
              if (lifecycle["op"] === "register" || lifecycle["op"] === "reincarnate") {
                for (const dependent of this.registry.outbox()) {
                  if (dependent.local_key !== record.key || dependent.method !== "session.gone") continue;
                  const gone = ObjectParams.parse(JSON.parse(dependent.params));
                  if (gone["after_reg_id"] !== lifecycle["reg_id"]) continue;
                  const { after_reg_id: _dependency, ...resolved } = gone;
                  this.registry.updateParams(dependent.id, { ...resolved, incarnation: updated.incarnation });
                }
              }
              const newest = this.registry.get(record.key) ?? record;
              // Later queued local DND/gone changes must remain effective before their ACK.
              const later = this.registry.outbox().some((pending) => pending.local_key === record.key && pending.id > entry.id && pending.method === "session.upsert");
              newest.session = { ...updated, ...(newest.session.state === "gone" ? { state: "gone" as const } : {}), ...(later ? { wake: newest.session.wake, capability: newest.session.capability } : {}) };
              this.registry.save(newest);
            }
            this.registry.remove(entry.id);
          });
          this.outcomes.set(entry.id, { result });
          progressed = true;
        } catch (error) {
          if (!(error instanceof RpcError)) { this.report("hub unavailable; commands remain queued"); return; }
          this.registry.fail(entry.id, `RPC ${error.code}: ${error.message}`);
          this.outcomes.set(entry.id, { error });
          this.report(`outbox command failed with RPC ${error.code}`);
          if (entry.method === "session.upsert") blocked.add(entry.local_key);
        }
      }
      if (!progressed || !this.transport.connected) break;
    }
    // Outcomes are only a response cache for current calls, not a second durable outbox.
    while (this.outcomes.size > 256) { const key = this.outcomes.keys().next().value; if (key === undefined) break; this.outcomes.delete(key); }
  }

  private markActedIds(record: LocalRecord, ids: string[]): void {
    const set = new Set(ids);
    for (const delivery of this.registry.pending(record.session.id ?? "")) if (set.has(delivery.message.id)) this.registry.acted(record, delivery.seq);
  }
  private async poll(record: LocalRecord, value: unknown): Promise<unknown> {
    const params = Poll.parse(value);
    if (params.event === "UserPromptSubmit") { record.stopBlocked = false; record.session.state = "active"; this.registry.save(record); }
    if (params.event === "Stop") { record.session.state = "idle"; this.registry.save(record); }
    if (params.event === "Stop" && (params.stop_hook_active || record.stopBlocked || record.session.wake === "off")) return { headers: [], cursor: 0, more: false, block: false, session: record.session };
    if (!record.session.id) throw new RpcError(-32021, "session registration is pending");
    const result = Results["inbox.list"].parse(await this.transport.request("inbox.list", { session_id: record.session.id, unread_only: true, waking_only: params.event === "Stop", limit: 200 }));
    const current = this.registry.get(record.key) ?? record;
    const block = params.event === "Stop" && current.session.wake === "on" && !current.stopBlocked && result.headers.length > 0;
    if (block) { current.stopBlocked = true; current.session.state = "active"; this.registry.save(current); }
    return { ...result, block, session: current.session };
  }

  private async deliverPending(key: string): Promise<void> {
    const active = this.deliveryRuns.get(key);
    if (active) return active;
    const run = this.performDelivery(key);
    this.deliveryRuns.set(key, run);
    try { await run; } finally { this.deliveryRuns.delete(key); }
  }
  private async performDelivery(key: string): Promise<void> {
    let record = this.registry.get(key);
    if (!record?.session.id || record.session.state === "gone" || record.session.wake === "off" || !this.transport.connected) return;
    if (record.lastWake !== undefined && this.clock.now() < record.lastWake + this.wake.cooldown) { this.wake.schedule(key, record.lastWake); return; }
    const pending = this.registry.pending(record.session.id).filter((delivery) => delivery.wake);
    if (!pending.length) return;
    const unread = new Set<string>();
    let cursor = 0;
    for (;;) {
      const page = Results["inbox.list"].parse(await this.transport.request("inbox.list", { session_id: record.session.id, since_seq: cursor, unread_only: false, waking_only: true, limit: 200 }));
      for (const header of page.headers) if (header.state === "unread") unread.add(header.id);
      if (!page.more) break;
      cursor = page.cursor;
    }
    record = this.registry.get(key);
    if (!record || record.session.wake !== "on" || record.session.state === "gone") return;
    for (const delivery of pending) if (!unread.has(delivery.message.id)) this.registry.acted(record, delivery.seq);
    const qualifying = pending.filter((delivery) => unread.has(delivery.message.id));
    const selected = qualifying[0];
    if (!selected) return;
    const result = await this.adapter(record).deliver(record, selected.message, true);
    if (result.outcome === "inbox") return;
    record = this.registry.get(key);
    if (!record) return;
    record.lastWake = this.clock.now();
    this.registry.save(record);
    if (result.outcome === "rejected") this.report("vendor rejected or held a native message; delivery remains unread");
    // One attempt covers the coalesced batch; all bodies remain available in the inbox.
    for (const delivery of qualifying) this.registry.acted(record, delivery.seq);
    if (result.outcome === "accepted") await this.write(record, "receipt.mark", { ids: [selected.message.id], state: "read" });
    const remaining = this.registry.pending(record.session.id ?? "").some((delivery) => delivery.wake);
    if (remaining) this.wake.schedule(key, record.lastWake);
  }

  status() {
    const outbox = this.registry.outbox();
    const issues = [
      ...(!this.transport.connected ? ["Hub disconnected; check kom doctor and kom logs."] : []),
      ...(outbox.some((entry) => entry.error) ? ["Outbox has blocked entries; inspect their error before deciding whether to resend."] : []),
    ];
    return {
      runtime_contract: 1, daemon: { pid: process.pid, version: RELEASE_VERSION, running: true }, hub: { connected: this.transport.connected },
      health: { state: issues.length ? "degraded" : "healthy", issues },
      outbox_depth: outbox.length,
      outbox: outbox.map((entry) => ({ id: entry.id, method: entry.method, age_ms: Math.max(0, this.clock.now() - entry.created_at), error: entry.error })),
      sessions: this.registry.all().map((record) => ({ ...record.session, acked_seq: record.acked, ...(record.permissionMode ? { permission_mode: record.permissionMode } : {}), ...(record.inboundPolicy ? { inbound_policy: record.inboundPolicy } : {}) })),
      ...(this.lastError ? { last_error: this.lastError, last_error_at: this.lastErrorAt } : {}),
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    this.wake.close();
    await this.transport.close();
    if (this.flushing) await this.flushing;
    await Promise.allSettled(this.deliveryRuns.values());
    this.registry.close();
  }
}
