import { RESYNC_PAGE_CAPABILITY, RUNTIME_CONTRACT, DaemonRuntimeParams, OperationSubmit, OperationStatusParams } from "@kommutator/protocol";
import { Operations, operationOwner, matchesOwner, type OperationOwner } from "./operations.js";
import { RELEASE_VERSION, DaemonStatusParams } from "@kommutator/protocol";
import { randomUUID, createHash } from "node:crypto";
import { basename, dirname, isAbsolute } from "node:path";
import { stat } from "node:fs/promises";
import * as z from "zod";
import { Methods, Notifications, Results, RegisteredSession, Session, Message, OutboundMessage, PROTOCOL_VERSION, toIdent, type MethodName } from "@kommutator/protocol";
import { claudeAdapter, claudeCapability } from "./adapters/claude.js";
import { codexAdapter } from "./adapters/codex.js";
import { genericAdapter } from "./adapters/generic.js";
import type { Adapter } from "./adapters/types.js";
import { resolveBinding } from "./binding.js";
import type { DaemonConfig } from "./config.js";
import { DaemonStoppingError, OfflineError, RpcError } from "./errors.js";
import type { HubTransport } from "./hub-link.js";
import { Registry, processStart, processExists, type GoneReason, type LocalRecord, type Delivery, type OutboxEntry } from "./registry.js";
import { realClock, WakeScheduler, type Clock } from "./wake.js";
import { compareProcessBirth } from "./process.js";
import { ResyncCoordinator } from "./resync.js";
import { Projects } from "./project.js";

export type Hello = z.infer<(typeof Methods)["ipc.hello"]>;
export interface IpcPeer { hello?: Hello; key?: string; ownerPid?: number; ownerBirth?: string; ownerGeneration?: number; ended?: boolean; operationOwner?: OperationOwner; operationsReady?: boolean }
interface RegistrationOwner { pid: number | undefined; birth: string | undefined; generation: number | undefined }
interface AcceptedRegistration { vendorId: string; pid: number; settled: Promise<RegistrationOwner | undefined> }
export interface CoreOptions {
  config: DaemonConfig;
  dbPath: string;
  transport: HubTransport;
  adapters?: Adapter[];
  clock?: Clock;
  processStart?: (pid: number) => Promise<string | undefined>;
  processExists?: (pid: number) => boolean | undefined;
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
  readonly operations: Operations;
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
  private readonly operationWaiters = new Map<number, { peer: IpcPeer; settle(): void; cancel(error: Error): void }>();
  private readonly deliveryRuns = new Map<string, Promise<void>>();
  private closed = false;
  private readonly resync: ResyncCoordinator;
  private readonly refreshedResyncOwners = new Map<string, LocalRecord>();
  private legacyResyncEpoch: number | undefined;
  private registrationTail: Promise<void> = Promise.resolve();
  private readonly acceptedRegistrations = new Set<AcceptedRegistration>();
  private readonly registrationWaiters = new Map<IpcPeer, Set<() => void>>();
  private readonly codexHookEvents = new Map<string, Set<string>>();
  private readonly projects = new Projects();

  constructor(private readonly options: CoreOptions) {
    this.registry = new Registry(options.dbPath);
    this.operations = new Operations(this.registry);
    this.transport = options.transport;
    this.config = options.config;
    this.clock = options.clock ?? realClock;
    this.adapters = new Map((options.adapters ?? [claudeAdapter, codexAdapter, genericAdapter]).map((adapter) => [adapter.vendor, adapter]));
    this.resync = new ResyncCoordinator(this.transport, this.registry, () => !this.closed,
      (record, deliveries) => this.ingest(record, deliveries));
    this.wake = new WakeScheduler(this.clock, async (key) => {
      try { await this.deliverPending(key); }
      catch { this.report("native delivery attempt failed; unread delivery retained"); }
    });
  }

  report(message: string): void { this.lastError = message; this.lastErrorAt = this.clock.now(); this.options.onError?.(message); }
  peer(): IpcPeer { const peer: IpcPeer = {}; this.peers.add(peer); return peer; }
  disconnect(peer: IpcPeer): void {
    this.peers.delete(peer);
    for (const waiter of this.operationWaiters.values()) if (waiter.peer === peer) waiter.cancel(new RpcError(-32020, "IPC peer disconnected; inspect operation status without resubmitting"));
    for (const cancel of this.registrationWaiters.get(peer) ?? []) cancel();
  }

  private requireOpen(): void { if (this.closed) throw new DaemonStoppingError(); }

  async start(): Promise<void> {
    await this.reconcileRetirements();
    for (const record of this.registry.all()) {
      if (record.session.state === "gone") continue;
      const probe = await this.probeLiveness(record);
      if (probe.alive === false) { this.markGone(record, "liveness", probe.reason); continue; }
      if (record.session.id && !this.registrationPending(record.key)) this.queueReincarnate(record);
    }
    this.transport.start(async () => { await this.synchronize(); }, (method, params) => {
      if (method === "deliver") {
        const delivery = Notifications.deliver.parse(params);
        const record = this.registry.byId(delivery.session_id);
        if (record) this.ingest(record, [delivery]);
      } else if (method === "config") this.wake.cooldown = Notifications.config.parse(params).coalesce_ms;
    });
  }

  async synchronize(): Promise<void> {
    const epoch = this.transport.epoch ?? 0;
    await this.flush();
    if (this.closed) return;
    if (!this.transport.connected || epoch !== (this.transport.epoch ?? 0)) throw new OfflineError();
    const live = this.registry.all().filter((record) => record.session.id && record.session.state !== "gone");
    await this.resyncOwners(live);
  }

  private ingest(expected: LocalRecord, deliveries: Delivery[]): void {
    const current = this.resync.current(expected);
    if (!current || this.closed) return;
    const waking = this.registry.transaction(() => {
      let waking = false;
      for (const delivery of deliveries) {
        const fresh = this.registry.receive(delivery);
        waking ||= fresh && delivery.wake;
      }
      return waking;
    });
    if (waking && current.session.wake === "on") this.wake.schedule(current.key, current.lastWake);
  }

  private async resyncOwners(records: LocalRecord[]): Promise<void> {
    const epoch = this.transport.epoch ?? 0;
    if (!this.transport.capabilities?.includes(RESYNC_PAGE_CAPABILITY) && this.legacyResyncEpoch !== epoch) {
      this.legacyResyncEpoch = epoch;
      this.options.onError?.("hub does not advertise bounded delivery resync; using legacy recovery");
    }
    await this.resync.run(records);
    if (this.closed || !this.transport.connected || epoch !== (this.transport.epoch ?? 0)) return;
    for (const expected of records) {
      const current = this.resync.current(expected);
      if (current && current.session.wake === "on" && this.registry.hasPendingWake(current.session.id ?? "")) {
        this.wake.schedule(current.key, current.lastWake);
      }
    }
  }

  private adapter(record: LocalRecord): Adapter { return this.adapters.get(record.session.vendor) ?? genericAdapter; }
  private diagnostic(event: string, record: LocalRecord, reason: string, cause?: string): void {
    this.report(JSON.stringify({ event, session_id: record.session.id, vendor: record.session.vendor,
      vendor_session_id: record.session.vendor_session_id, pid: record.pid,
      owner_generation: record.ownerGeneration, reason, ...(cause ? { cause } : {}) }));
  }
  private errorCategory(error: unknown): string {
    if (error instanceof RpcError) return `rpc:${error.code}`;
    if (error instanceof OfflineError) return "hub-unavailable";
    return "transport-or-probe-error";
  }
  private async alive(record: LocalRecord): Promise<boolean | undefined> { return (await this.probeLiveness(record)).alive; }
  private async probeLiveness(record: LocalRecord): Promise<{ alive: boolean | undefined; reason: string }> {
    if (this.options.isAlive) return { alive: await this.options.isAlive(record), reason: "injected-liveness-probe" };
    if (!record.pid || !record.processStartedAt) return { alive: false, reason: "missing-process-owner" };
    let birth: string | undefined;
    try { birth = await (this.options.processStart ?? processStart)(record.pid); }
    catch { /* Unknown probe outcome is not proof of exit. */ }
    if (birth === undefined) {
      if ((this.options.processExists ?? processExists)(record.pid) === false) return { alive: false, reason: "process-exited" };
      this.diagnostic("session.liveness-unverified", record, "process-birth-unavailable");
      return { alive: undefined, reason: "process-birth-unavailable" };
    }
    const comparison = compareProcessBirth(birth, record.processStartedAt);
    if (comparison === "different") return { alive: false, reason: "process-birth-changed" };
    if (comparison === "unverified") return { alive: undefined, reason: "process-birth-format-unverified" };
    try { if (await this.adapter(record).isAlive(record)) return { alive: true, reason: "verified-owner" }; }
    catch { /* Adapter unavailability alone cannot retire an OS process. */ }
    if ((this.options.processExists ?? processExists)(record.pid) === false) return { alive: false, reason: "process-exited" };
    this.diagnostic("session.liveness-unverified", record, "adapter-unavailable");
    return { alive: undefined, reason: "adapter-unavailable" };
  }
  private registrationPending(key: string): boolean {
    return this.registry.outbox().some((entry) => entry.local_key === key && entry.method === "session.upsert" &&
      ["register", "reincarnate"].includes(ObjectParams.parse(JSON.parse(entry.params))["op"] as string));
  }
  private queueReincarnate(record: LocalRecord): void {
    this.registry.enqueue(record.key, "session.upsert", { op: "reincarnate", session: record.session, reg_id: randomUUID() }, this.clock.now());
  }
  private markGone(record: LocalRecord, reason: GoneReason, cause?: string): void {
    record.goneReason = reason;
    record.lifecycleEpoch = (record.lifecycleEpoch ?? 0) + 1;
    this.codexHookEvents.delete(record.key);
    this.wake.cancel(record.key);
    for (const peer of this.peers) if (peer.key === record.key) peer.ended = true;
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
    this.diagnostic("session.gone", record, reason, cause);
  }

  private async reconcileRetirements(matches: (record: LocalRecord) => boolean = () => true): Promise<void> {
    if (!isAbsolute(this.options.dbPath)) return;
    const home = dirname(this.options.dbPath);
    for (const record of this.registry.all()) {
      if (!matches(record) || (record.session.state === "gone" && record.goneReason !== "liveness")) continue;
      const adapter = this.adapter(record);
      if (!adapter.isEnded) continue;
      let ended = false;
      try { ended = await adapter.isEnded(record, home); } catch { /* Missing evidence is not an end. */ }
      if (!ended) continue;
      this.requireOpen();
      const current = this.registry.get(record.key);
      if (!current || (current.session.state === "gone" && current.goneReason !== "liveness") || current.pid !== record.pid ||
          current.processStartedAt !== record.processStartedAt || current.ownerGeneration !== record.ownerGeneration ||
          current.lifecycleEpoch !== record.lifecycleEpoch) continue;
      if (current.session.state === "gone") {
        current.goneReason = "session-end";
        current.lifecycleEpoch = (current.lifecycleEpoch ?? 0) + 1;
        this.registry.save(current);
        this.diagnostic("session.gone", current, "session-end", "durable-vendor-end");
      } else this.markGone(current, "session-end", "durable-vendor-end");
    }
  }

  async sweep(): Promise<void> {
    await this.reconcileRetirements();
    for (const record of this.registry.all()) {
      if (record.session.state === "gone") continue;
      const probe = await this.probeLiveness(record);
      const current = this.registry.get(record.key);
      if (!current || current.session.state === "gone" || current.pid !== record.pid || current.processStartedAt !== record.processStartedAt || current.ownerGeneration !== record.ownerGeneration || current.lifecycleEpoch !== record.lifecycleEpoch) continue;
      if (probe.alive === false) this.markGone(current, "liveness", probe.reason);
      else if (this.transport.connected && current.session.id) {
        try { await this.transport.request("session.heartbeat", { session_id: current.session.id, state: current.session.state }); }
        catch (error) { this.diagnostic("session.heartbeat-failed", current, this.errorCategory(error)); }
      }
    }
    await this.flush();
  }

  private async register(hello: Hello, human = false): Promise<LocalRecord> {
    const previous = this.registrationTail;
    let release!: () => void;
    this.registrationTail = new Promise<void>(resolve => { release = resolve; });
    let complete: ((owner: RegistrationOwner | undefined) => void) | undefined;
    const ticket: AcceptedRegistration | undefined = !human && hello.client === "hook" && hello.vendor === "claude-code" &&
      hello.vendor_session_id && hello.ppid && hello.owner_generation === undefined
      ? { vendorId: hello.vendor_session_id, pid: hello.ppid, settled: new Promise(resolve => { complete = resolve; }) } : undefined;
    if (ticket) this.acceptedRegistrations.add(ticket);
    let owner: RegistrationOwner | undefined;
    try {
      await previous;
      this.requireOpen();
      const record = await this.registerOwner(hello, human);
      owner = { pid: record.pid, birth: record.processStartedAt, generation: record.ownerGeneration };
      return record;
    } finally {
      if (ticket) this.acceptedRegistrations.delete(ticket);
      complete?.(owner);
      release();
    }
  }

  private async registerOwner(hello: Hello, human = false): Promise<LocalRecord> {
    const vendor = human ? "other" : hello.vendor ?? "other";
    const vendorId = human ? `human:${createHash("sha256").update(hello.cwd ?? "").digest("hex").slice(0, 24)}` : hello.vendor_session_id;
    let key = vendorId ? `${vendor}:${vendorId}` : `shim:${hello.pid}`;
    const pid = hello.client === "hook" ? hello.ppid : hello.pid;
    let birth: string | undefined;
    try { birth = pid ? await (this.options.processStart ?? processStart)(pid) : undefined; } catch { /* Missing process evidence cannot establish ownership. */ }
    if (vendor === "codex" && (!pid || !birth)) throw new RpcError(-32020, "Codex process ownership unavailable; retry after the process probe recovers.");
    const project = hello.cwd ? await this.projects.key(hello.cwd, this.options.project ?? hello.project_key) : undefined;
    this.requireOpen();
    let existing = this.registry.get(key);
    if (vendor === "claude-code") {
      if (!vendorId || !pid || !birth) throw new RpcError(-32020, "Claude process ownership unavailable; restart this session with trusted hooks");
      await this.reconcileRetirements(record => record.session.vendor === vendor && record.pid === pid && record.processStartedAt === birth);
      this.requireOpen();
      if (this.registry.all().some(record => record.session.vendor === vendor && record.pid === pid &&
        compareProcessBirth(record.processStartedAt, birth) === "unverified")) {
        throw new RpcError(-32020, "Legacy Claude owner requires a new OS process after upgrading all hooks and MCP; use /exit, then claude --resume");
      }
      const owned = this.registry.all().filter(record => record.session.vendor === vendor && record.pid === pid && record.processStartedAt === birth);
      const latestGeneration = Math.max(0, ...owned.map(record => record.ownerGeneration ?? 0));
      const generation = hello.owner_generation ?? 0;
      if (generation < latestGeneration || (generation === latestGeneration && owned.some(record =>
        (record.ownerGeneration ?? 0) === generation && ((generation > 0 && record.session.vendor_session_id !== vendorId) ||
          (record.session.vendor_session_id === vendorId && record.session.state === "gone" && (generation === 0 || record.goneReason !== "liveness")))))) {
        throw new RpcError(-32020, "stale or conflicting Claude conversation generation; use /exit, then claude --resume with trusted hooks");
      }
      if (generation > latestGeneration) for (const prior of owned) {
        if (prior.session.state === "gone") continue;
        this.wake.cancel(prior.key);
        // A repeated SessionStart refreshes its fence without ending the same conversation.
        if (prior.session.vendor_session_id !== vendorId) this.markGone(prior, "superseded");
      }
      const candidates = this.registry.all().filter(record => record.session.vendor === vendor && record.session.vendor_session_id === vendorId);
      const sameOwner = candidates.filter(record => record.pid === pid && record.processStartedAt === birth);
      if (sameOwner.length > 1) throw new RpcError(-32020, "ambiguous Claude process ownership");
      existing = sameOwner[0];
      if (existing && (existing.session.cwd !== hello.cwd || existing.session.project_key !== project)) {
        throw new RpcError(-32020, "Conflicting project context for this Claude process owner; start a fresh session");
      }
      if (!existing && candidates.length === 1) {
        const prior = candidates[0];
        if (prior?.pid && prior.processStartedAt && prior.session.cwd === hello.cwd && prior.session.project_key === project) {
          const observedBirth = await (this.options.processStart ?? processStart)(prior.pid);
          const provenDead = observedBirth === undefined && (this.options.processExists ?? processExists)(prior.pid) === false;
          if (provenDead || compareProcessBirth(observedBirth, prior.processStartedAt) === "different") existing = prior;
        }
      }
      if (existing) key = existing.key;
      else if (candidates.length) key = `${key}:owner:${createHash("sha256").update(`${pid}:${birth}`).digest("hex")}`;
    }
    this.requireOpen();
    const record: LocalRecord = existing ?? {
      key, acked: 0, stopBlocked: false,
      session: Session.parse({
        host: this.config.host, name: human ? "human" : toIdent(`${vendor}-${basename(hello.cwd ?? "session")}-${this.registry.all().length + 1}`),
        vendor, ...(vendorId ? { vendor_session_id: vendorId } : {}),
        ...(hello.cwd ? { cwd: hello.cwd, project_key: project } : {}),
        capability: vendor === "other" ? "none" : "hook",
      }),
    };
    const resyncBefore = existing ? structuredClone(existing) : undefined;
    const wasGone = record.session.state === "gone";
    const launchChanged = Boolean(existing && (
      (pid !== undefined && record.pid !== undefined && pid !== record.pid) ||
      (birth !== undefined && record.processStartedAt !== undefined && birth !== record.processStartedAt) ||
      (hello.endpoint !== undefined && record.endpoint !== undefined && hello.endpoint !== record.endpoint)
    ));
    const refreshOwner = vendor === "claude-code" && existing && !wasGone && !launchChanged &&
      record.pid === pid && record.processStartedAt === birth && record.ownerGeneration !== undefined &&
      (hello.endpoint ?? record.endpoint) === record.endpoint &&
      hello.owner_generation !== undefined && hello.owner_generation === record.ownerGeneration + 1
      ? operationOwner(record) : undefined;
    if (launchChanged || (hello.owner_generation !== undefined && hello.owner_generation !== record.ownerGeneration)) {
      record.lifecycleEpoch = (record.lifecycleEpoch ?? 0) + 1;
    }
    if (wasGone || launchChanged) {
      this.codexHookEvents.delete(key);
      delete record.pid;
      delete record.processStartedAt;
      delete record.endpoint;
      delete record.token;
      delete record.permissionMode;
      delete record.inboundPolicy;
      delete record.lastWake;
      record.stopBlocked = false;
    }
    if (hello.owner_generation !== undefined && hello.owner_generation !== record.ownerGeneration) {
      delete record.lastWake;
      record.stopBlocked = false;
    }
    if (hello.owner_generation !== undefined) record.ownerGeneration = hello.owner_generation;
    else delete record.ownerGeneration;
    if (pid) record.pid = pid;
    if (birth) record.processStartedAt = birth;
    if (hello.endpoint !== undefined) record.endpoint = hello.endpoint;
    if (hello.token !== undefined) record.token = hello.token;
    if (hello.permission_mode !== undefined) record.permissionMode = hello.permission_mode;
    if (hello.inbound_policy !== undefined) record.inboundPolicy = hello.inbound_policy;
    const previousCapability = record.session.capability;
    const endpointPeers = vendor === "claude-code" && record.endpoint ? this.registry.all().filter(other =>
      other.key !== record.key && other.session.state !== "gone" && other.session.vendor === "claude-code" &&
      other.session.vendor_session_id === vendorId && other.endpoint === record.endpoint) : [];
    record.session.capability = vendor === "claude-code" ? (endpointPeers.length ? "hook" : claudeCapability(record)) : this.adapter(record).capability;
    record.session.state = "active";
    delete record.goneReason;
    this.registry.transaction(() => {
      this.registry.save(record);
      if (refreshOwner) this.operations.refresh(refreshOwner, record);
      for (const other of endpointPeers) {
        if (other.session.capability === "hook") continue;
        other.session.capability = "hook";
        this.registry.save(other);
        this.registry.enqueue(other.key, "session.upsert", { op: "update", session: { capability: "hook" } }, this.clock.now());
      }
      if (!existing) {
        const { id: _id, incarnation: _incarnation, ...session } = record.session;
        this.registry.enqueue(key, "session.upsert", { op: "register", session, reg_id: randomUUID() }, this.clock.now());
      } else if (wasGone || launchChanged) this.queueReincarnate(record);
      if (existing && previousCapability !== record.session.capability) {
        this.registry.enqueue(key, "session.upsert", { op: "update", session: { capability: record.session.capability } }, this.clock.now());
      }
    });
    // Registration verified this replacement authority. Never adopt a held page
    // for the old fence; request a fresh scan after queued policy writes settle.
    if (resyncBefore && !wasGone && !launchChanged && record.session.id && !this.resync.current(resyncBefore)) {
      this.refreshedResyncOwners.set(record.key, structuredClone(record));
    }
    return record;
  }

  /** Re-read after every asynchronous boundary before using a pinned owner's data. */
  private currentOwner(peer: IpcPeer, expected: LocalRecord): LocalRecord {
    const current = this.registry.get(expected.key);
    if (peer.ended || !current || current.session.state === "gone") throw new RpcError(-32020, "bound session has ended or is unavailable; open a new connection");
    if (current.session.vendor === "claude-code" && (current.pid !== peer.ownerPid || current.processStartedAt !== peer.ownerBirth ||
      current.pid !== expected.pid || current.processStartedAt !== expected.processStartedAt ||
      current.ownerGeneration !== peer.ownerGeneration || current.ownerGeneration !== expected.ownerGeneration)) {
      throw new RpcError(-32020, "bound Claude process owner has changed or exited; open a new session connection");
    }
    return current;
  }

  /** A ticket only delays lookup; it never supplies binding authority. */
  private async awaitAcceptedRegistration(peer: IpcPeer): Promise<boolean> {
    const hello = peer.hello;
    if (!hello || hello.client !== "shim" || hello.vendor !== "claude-code" || !hello.vendor_session_id ||
      hello.owner_generation !== undefined || !peer.ownerPid || !peer.ownerBirth) return false;
    if (this.registry.all().some(record => record.session.vendor === "claude-code" &&
      record.session.vendor_session_id === hello.vendor_session_id && record.pid === peer.ownerPid &&
      record.processStartedAt === peer.ownerBirth)) return false;
    const tickets = [...this.acceptedRegistrations].filter(ticket => ticket.vendorId === hello.vendor_session_id && ticket.pid === peer.ownerPid);
    if (tickets.length === 0) return false;
    const owners = await new Promise<Array<RegistrationOwner | undefined>>((resolve, reject) => {
      let finished = false;
      let timer: unknown;
      const listeners = this.registrationWaiters.get(peer) ?? new Set<() => void>();
      this.registrationWaiters.set(peer, listeners);
      const finish = (error?: Error, result?: Array<RegistrationOwner | undefined>) => {
        if (finished) return;
        finished = true;
        this.clock.clearTimeout(timer);
        listeners.delete(cancel);
        if (listeners.size === 0) this.registrationWaiters.delete(peer);
        if (error) reject(error); else resolve(result ?? []);
      };
      const cancel = () => finish(this.closed ? new DaemonStoppingError() : new RpcError(-32020, "session connection closed while registration was pending"));
      listeners.add(cancel);
      timer = this.clock.setTimeout(() => finish(new RpcError(-32020, "accepted hook registration is still pending; retry the identity lookup")), 250);
      void Promise.all(tickets.map(ticket => ticket.settled)).then(result => finish(undefined, result));
    });
    this.requireOpen();
    if (!this.peers.has(peer)) throw new RpcError(-32020, "session connection closed while registration was pending");
    if (owners.some(owner => !owner || owner.pid !== peer.ownerPid || owner.birth !== peer.ownerBirth || owner.generation !== undefined)) {
      throw new RpcError(-32020, "accepted hook registration did not establish the pinned Claude owner");
    }
    return true;
  }

  private async bind(peer: IpcPeer): Promise<LocalRecord> {
    this.requireOpen();
    if (!peer.hello || peer.hello.client === "cli") throw new RpcError(-32020, "session requires ipc.hello from its shim or hook");
    if (peer.key !== undefined) {
      const cached = this.registry.get(peer.key);
      if (!cached) throw new RpcError(-32020, "bound session has ended or is unavailable; open a new connection");
      this.currentOwner(peer, cached);
      if (cached.session.vendor === "claude-code" && (!peer.ownerPid ||
        await (this.options.processStart ?? processStart)(peer.ownerPid) !== peer.ownerBirth)) {
        throw new RpcError(-32020, "bound Claude process owner has changed or exited; open a new session connection");
      }
      this.requireOpen();
      return this.currentOwner(peer, cached);
    }
    if (peer.hello.vendor === "claude-code") {
      const pid = peer.hello.ppid;
      const birth = pid ? await (this.options.processStart ?? processStart)(pid) : undefined;
      this.requireOpen();
      if (!this.peers.has(peer) || peer.ended) throw new RpcError(-32020, "session connection closed while binding Claude owner");
      if (!pid || !birth) throw new RpcError(-32020, "Claude process ownership unavailable; restart this session with trusted hooks");
      if (peer.ownerBirth !== undefined && (peer.ownerPid !== pid || peer.ownerBirth !== birth)) {
        throw new RpcError(-32020, "bound Claude process owner has changed or exited; open a new session connection");
      }
      peer.ownerPid = pid;
      peer.ownerBirth = birth;
      if (peer.hello.owner_generation !== undefined) peer.ownerGeneration = peer.hello.owner_generation;
      if (await this.awaitAcceptedRegistration(peer)) {
        const currentBirth = await (this.options.processStart ?? processStart)(pid);
        this.requireOpen();
        if (!this.peers.has(peer) || peer.ended || currentBirth !== birth) {
          throw new RpcError(-32020, "bound Claude process owner has changed or exited; open a new session connection");
        }
      }
    }
    // Resolve only a fresh snapshot: a hook may have replaced the owner while its
    // process birth was being probed. Even a not-yet-bound peer pins that first birth.
    this.requireOpen();
    const records = this.registry.all().filter(record => peer.hello?.vendor !== "claude-code" ||
      (record.pid === peer.ownerPid && record.processStartedAt === peer.ownerBirth));
    const bound = new Set([...this.peers].filter((candidate) => candidate !== peer && candidate.hello?.client === "shim").flatMap((candidate) => candidate.key ? [candidate.key] : []));
    const record = resolveBinding(peer.hello, records, bound);
    peer.key = record.key;
    return this.currentOwner(peer, record);
  }

  async request(peer: IpcPeer, method: string, value: unknown = {}): Promise<unknown> {
    if (this.closed) throw new DaemonStoppingError();
    if (method === "ipc.hello") {
      if (peer.hello) throw new RpcError(-32600, "ipc.hello may only be sent once per connection");
      const parsed = Methods["ipc.hello"].safeParse(value);
      if (!parsed.success) throw new RpcError(-32602, "invalid ipc.hello parameters");
      if (parsed.data.vendor === "claude-code" && parsed.data.client !== "cli" && parsed.data.runtime_contract !== RUNTIME_CONTRACT) {
        throw new RpcError(-32601, `Incompatible Claude runtime contract: expected ${RUNTIME_CONTRACT}, observed ${parsed.data.runtime_contract ?? "missing"}; upgrade all hooks/MCP and restart the client process`);
      }
      peer.hello = parsed.data;
      if (parsed.data.protocol_version !== PROTOCOL_VERSION) this.report("IPC protocol version differs from daemon");
      if (parsed.data.client === "cli") return { bound: false };
      if (parsed.data.vendor === "codex") {
        if (!parsed.data.vendor_session_id) throw new RpcError(-32602, "Codex requires an explicit vendor_session_id");
        if (parsed.data.client === "shim") {
          const record = await this.register(parsed.data);
          peer.key = record.key;
          if (record.pid && record.processStartedAt) peer.operationOwner = operationOwner(record);
        } else {
          // Hooks have no stable PID. Only the MCP shim may create or revive a root.
          await this.bind(peer);
        }
      } else if (parsed.data.client === "hook") {
        if (!parsed.data.vendor_session_id) throw new RpcError(-32602, "hook requires vendor_session_id");
        const record = await this.register(parsed.data);
        peer.key = record.key;
        if (record.pid !== undefined) peer.ownerPid = record.pid;
        if (record.processStartedAt !== undefined) peer.ownerBirth = record.processStartedAt;
        if (record.ownerGeneration !== undefined) peer.ownerGeneration = record.ownerGeneration;
      } else if (!parsed.data.vendor_session_id && (!parsed.data.vendor || parsed.data.vendor === "other")) {
        const record = await this.register(parsed.data);
        peer.key = record.key;
        if (record.pid && record.processStartedAt) peer.operationOwner = operationOwner(record);
      } else {
        try { const bound = await this.bind(peer); if (bound.pid && bound.processStartedAt) peer.operationOwner = operationOwner(bound); } catch (error) { if (!(error instanceof RpcError)) throw error; }
      }
      this.requireOpen();
      if (parsed.data.client === "shim" && parsed.data.vendor === "claude-code" && (!this.peers.has(peer) || peer.ended)) {
        throw new RpcError(-32020, "session connection closed while binding Claude owner");
      }
      await this.flush();
      this.requireOpen();
      if (parsed.data.client === "shim" && parsed.data.vendor === "claude-code" && (!this.peers.has(peer) || peer.ended)) {
        throw new RpcError(-32020, "session connection closed while binding Claude owner");
      }
      const found = peer.key ? this.registry.get(peer.key) : undefined;
      const record = found ? this.currentOwner(peer, found) : undefined;
      if (peer.operationOwner && record && matchesOwner(peer.operationOwner, record)) {
        if (!peer.operationOwner.sessionId && record.session.id) peer.operationOwner.sessionId = record.session.id;
        peer.operationsReady = true;
      }
      return record?.session.id ? { bound: true, session: record.session } : { bound: Boolean(record), pending: true };
    }
    if (!peer.hello) throw new RpcError(-32020, "ipc.hello is required before requests");
    if (method === "daemon.runtime") {
      this.requireCli(peer);
      if (!DaemonRuntimeParams.safeParse(value).success) throw new RpcError(-32602, "invalid daemon.runtime parameters");
      return { runtime_contract: RUNTIME_CONTRACT, daemon: { version: RELEASE_VERSION } };
    }
    if (method === "daemon.status" || method === "status") {
      const parsed = DaemonStatusParams.safeParse(value);
      if (!parsed.success) throw new RpcError(-32602, "invalid daemon.status parameters");
      if (parsed.data.caller) this.requireCli(peer);
      void this.reconcileRetirements().then(() => this.flush()).catch(() => this.report("retirement reconciliation failed"));
      return this.statusForCaller(parsed.data.caller);
    }
    if (method === "board.get" && peer.hello.client === "cli") {
      const params = Methods["board.get"].strict().parse(value);
      const records = this.registry.all().filter(record => record.session.id === params.session_id);
      const record = records.length === 1 ? records[0] : undefined;
      if (!record || record.session.state === "gone") throw new RpcError(-32020, "Board read requires an exact existing live local session ID");
      const epoch = record.lifecycleEpoch;
      const result = Results["board.get"].parse(await this.transport.request("board.get", params));
      const current = this.registry.get(record.key);
      if (!current || current.session.id !== params.session_id || current.session.state === "gone" || current.lifecycleEpoch !== epoch) {
        throw new RpcError(-32020, "Board read session changed; select an existing live local session ID");
      }
      return result;
    }
    if (method === "watch.poll") {
      this.requireCli(peer);
      const params = Methods["watch.poll"].parse(value);
      const records = this.registry.all().filter(record => record.session.id === params.session_id);
      const record = records.length === 1 ? records[0] : undefined;
      if (!record) throw new RpcError(-32020, "Watch requires an exact existing local session ID");
      const paused = (current: LocalRecord) => current.session.state === "gone" ? "gone" : current.session.wake === "off" ? "dnd" : undefined;
      const empty = (state: "gone" | "dnd") => ({ headers: [], more: false, state, ...(params.since_seq === undefined ? {} : { cursor: params.since_seq }) });
      const before = paused(record);
      if (before) return empty(before);
      const epoch = record.lifecycleEpoch;
      const result = Results["watch.poll"].parse(await this.transport.request("watch.poll", params));
      const current = this.registry.get(record.key);
      if (!current || current.session.id !== params.session_id || current.lifecycleEpoch !== epoch) return empty("gone");
      const after = paused(current);
      return after ? empty(after) : result;
    }
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
        .map(async (record) => ({ id: record.session.id, shim_alive: (await this.alive(record)) ?? null, hook_events: [...(this.codexHookEvents.get(record.key) ?? [])] })));
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
      const params = z.object({ message: OutboundMessage.omit({ from: true }).extend({ from: z.string().optional() }) }).parse(value);
      const record = await this.register(peer.hello, true);
      return this.send(record, { ...params.message, from: "", force_wake: params.message.origin === "human" && params.message.force_wake });
    }
    if (method === "session.list") await this.reconcileRetirements();
    const record = this.currentOwner(peer, await this.bind(peer));
    if (method === "operation.status" || method === "operation.submit") {
      this.trackedOwner(peer, record);
      if (method === "operation.status") {
        const parsed = OperationStatusParams.safeParse(value);
        if (!parsed.success) throw new RpcError(-32602, "invalid operation lookup");
        return this.operations.status(parsed.data.operation_id, record, this.clock.now());
      }
      const parsed = OperationSubmit.safeParse(value);
      if (!parsed.success) throw new RpcError(-32602, "invalid tracked mutation parameters");
      const operation = parsed.data;
      const replay = randomUUID();
      const params = operation.method === "message.send"
        ? { message: { ...operation.params.message, from: "" }, idempotency_key: replay }
        : operation.params;
      this.validate(operation.method, { ...params, session_id: record.session.id ?? "pending" });
      const id = this.operations.admit(operation.operation_id, record, operation.method, params, this.clock.now());
      if (operation.method === "receipt.mark") this.markActedIds(record, operation.params.ids);
      await this.flushOperation(id, peer);
      const current = this.trackedOwner(peer, this.currentOwner(peer, record));
      const outcome = this.outcomes.get(id); this.outcomes.delete(id);
      const status = this.operations.status(operation.operation_id, current, this.clock.now());
      if (status.outcome === "confirmed") return { ...status.result, ...(operation.method === "message.send" ? { status: "sent" } : {}), operation_id: operation.operation_id };
      if (status.outcome === "blocked") return status;
      if (outcome?.error) throw outcome.error;
      if (outcome?.result) return { ...Results[operation.method].parse(outcome.result), ...(operation.method === "message.send" ? { status: "sent" } : {}), operation_id: operation.operation_id };
      if (this.registry.outboxEntry(id)) return { status: "queued", operation_id: operation.operation_id,
        ...(operation.method === "message.send" ? { idempotency_key: replay } : { outbox_id: id }), outbox_depth: this.registry.outbox().length };
      return { outcome: "unknown", operation_id: operation.operation_id };
    }
    if (method === "whoami") {
      await this.flush();
      const current = this.currentOwner(peer, record);
      if (!current.session.id) throw new RpcError(-32021, "session registration is pending hub connectivity");
      const topics = Results["topic.list"].parse(await this.transport.request("topic.list", { session_id: current.session.id }));
      this.currentOwner(peer, record);
      return { session: RegisteredSession.parse(current.session), topics: topics.topics };
    }
    if (method === "hook.poll") {
      const event = Poll.parse(value).event;
      const result = await this.poll(peer, record, value);
      this.currentOwner(peer, record);
      if (record.session.vendor === "codex" && peer.hello.client === "hook") {
        const events = this.codexHookEvents.get(record.key) ?? new Set<string>();
        events.add(event); this.codexHookEvents.set(record.key, events);
      }
      return result;
    }
    if (method === "hook.ack") {
      const params = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(value);
      const result = await this.write(record, "receipt.mark", { ids: params.ids, state: "read" });
      this.currentOwner(peer, record);
      return result;
    }
    const params = ObjectParams.parse(value);
    // Callers cannot choose local identity, authorship, replay keys or lifecycle epochs.
    if ("session_id" in params || "idempotency_key" in params || "op_id" in params || "reg_id" in params) throw new RpcError(-32602, "caller identity and replay keys are assigned by agentd");
    if (method === "message.send") {
      const message = OutboundMessage.parse({ ...ObjectParams.parse(params["message"]), from: "" });
      if (message.origin !== "agent" || message.force_wake) throw new RpcError(-32602, "agent sessions cannot send human-origin or force-wake messages");
      const result = await this.send(record, message);
      this.currentOwner(peer, record);
      return result;
    }
    if (method === "session.upsert") {
      if (params["op"] !== "update") throw new RpcError(-32602, "registration lifecycle is managed by agentd");
      const update = z.object({ name: z.string().optional(), role: z.string().optional(), status_line: z.string().optional(), wake: z.enum(["on", "off"]).optional() }).strict().parse(params["session"]);
      if (update.wake) { record.session.wake = update.wake; this.registry.save(record); }
      const result = await this.write(record, method, { op: "update", session: update });
      this.currentOwner(peer, record);
      return result;
    }
    if (method === "session.gone") {
      this.markGone(record, "session-end");
      void this.flush();
      return { ok: true };
    }
    if (READ_METHODS.has(method)) {
      await this.flush();
      const current = this.currentOwner(peer, record);
      if (!current.session.id) throw new RpcError(-32021, "session registration is pending");
      const parsed = this.validate(method, { ...params, session_id: current.session.id });
      const response = await this.transport.request(method, parsed);
      const latest = this.currentOwner(peer, record);
      if (method === "message.read") {
        const body = Results["message.read"].parse(response);
        this.markActedIds(latest, [body.message.id]);
      }
      return response;
    }
    if (WRITE_METHODS.has(method)) {
      const result = await this.write(record, method, params);
      this.currentOwner(peer, record);
      return result;
    }
    throw new RpcError(-32601, "unknown or unavailable IPC method");
  }

  private trackedOwner(peer: IpcPeer, record: LocalRecord): LocalRecord {
    if (!this.peers.has(peer) || peer.hello?.client !== "shim" || !peer.operationsReady || !peer.operationOwner || !matchesOwner(peer.operationOwner, record)) {
      throw new RpcError(-32020, "tracked operation owner is unavailable or changed; open a new session connection");
    }
    if (!peer.operationOwner.sessionId && record.session.id) peer.operationOwner.sessionId = record.session.id;
    return record;
  }
  private blockOperation(id: number, reason: string, category: "missing-session" | "replay-horizon" | "hub-rpc", code?: number): void {
    this.registry.transaction(() => {
      this.registry.fail(id, reason);
      this.operations.block(id, { category, ...(code !== undefined ? { code } : {}) }, this.clock.now());
    });
    this.operationWaiters.get(id)?.settle();
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
  private async flushOperation(id: number, peer: IpcPeer): Promise<void> {
    const settled = new Promise<void>((resolve, reject) => {
      this.operationWaiters.set(id, { peer, settle: resolve, cancel: reject });
    });
    try {
      await Promise.race([settled, this.flush()]);
      this.requireOpen();
    } finally { this.operationWaiters.delete(id); }
  }
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushQueue();
    try { await this.flushing; } finally { this.flushing = undefined; }
  }
  private async flushQueue(): Promise<void> {
    if (!this.transport.connected) return;
    const resyncAfterFlush = new Set<string>();
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
        if (!record) { this.blockOperation(entry.id, "local session is missing", "missing-session"); continue; }
        if (this.clock.now() - entry.created_at > REPLAY_HORIZON) {
          this.blockOperation(entry.id, "replay horizon exceeded (7 days); manual intervention required", "replay-horizon");
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
              // A pending initial registration may settle after a continuous refresh.
              // Attach only already-current observations, never transfer predecessor rows here.
              const refreshedRegistration = lifecycle["op"] === "register" && !record.session.id &&
                newest.session.id === updated.id && newest.session.state !== "gone" &&
                record.key === newest.key && record.session.vendor === "claude-code" && newest.session.vendor === "claude-code" &&
                record.session.vendor_session_id === newest.session.vendor_session_id &&
                record.pid !== undefined && record.pid === newest.pid && record.processStartedAt !== undefined &&
                record.processStartedAt === newest.processStartedAt && record.endpoint === newest.endpoint &&
                record.session.cwd === newest.session.cwd && record.session.project_key === newest.session.project_key &&
                record.ownerGeneration !== undefined && newest.ownerGeneration !== undefined &&
                newest.ownerGeneration > record.ownerGeneration;
              if (matchesOwner(operationOwner(record), newest) || refreshedRegistration) this.operations.attach(newest);
            }
            const tracked = this.operations.confirm(entry.id, result, this.clock.now());
            this.registry.remove(entry.id);
            if (tracked) this.operations.prune(this.clock.now());
          });
          if (entry.method === "session.upsert" && ["register", "reincarnate"].includes(String(ObjectParams.parse(params)["op"]))) {
            const current = this.registry.get(record.key);
            if (ObjectParams.parse(params)["op"] === "reincarnate") resyncAfterFlush.add(record.key);
            // Retirement cancels timers. Re-arm retained work only after the final
            // lifecycle ACK, including recovery after the old delivery already drained.
            if (current && current.session.state !== "gone" && current.session.wake === "on" &&
              !this.registrationPending(current.key) && this.registry.hasPendingWake(current.session.id ?? "")) {
              this.wake.schedule(current.key, current.lastWake);
            }
          }
          this.outcomes.set(entry.id, { result });
          this.operationWaiters.get(entry.id)?.settle();
          progressed = true;
        } catch (error) {
          if (!(error instanceof RpcError)) { this.report("hub unavailable; commands remain queued"); return; }
          this.blockOperation(entry.id, `RPC ${error.code}: ${error.message}`, "hub-rpc", error.code);
          this.outcomes.set(entry.id, { error });
          this.report(`outbox command failed with RPC ${error.code}`);
          if (entry.method === "session.upsert") blocked.add(entry.local_key);
        }
      }
      if (!progressed || !this.transport.connected) break;
    }
    // Flush queued policy updates first: a temporary hub DND value must not become
    // the immutable local wake decision for a newly received delivery.
    const reincarnated: LocalRecord[] = [];
    for (const key of resyncAfterFlush) {
      const current = this.registry.get(key);
      if (!current?.session.id || current.session.state === "gone" || this.registrationPending(key)) continue;
      reincarnated.push(current);
    }
    if (reincarnated.length > 0) {
      try {
        // Submit the finite eligible set together so startup recovery round-robins
        // owners rather than draining the first owner's backlog before its sibling.
        await this.resyncOwners(reincarnated);
      } catch {
        // Lifecycle ACKs are already committed; reconnect retries resync.
        this.report("delivery resync after reincarnation failed; reconnect will retry");
      }
    }
    const refreshed: LocalRecord[] = [];
    for (const [key, expected] of this.refreshedResyncOwners) {
      const current = this.resync.current(expected);
      if (!current) { this.refreshedResyncOwners.delete(key); continue; }
      if (this.registrationPending(key)) continue;
      this.refreshedResyncOwners.delete(key);
      refreshed.push(current);
    }
    if (refreshed.length > 0 && this.transport.connected) {
      // Do not make registration wait behind an old held response. The coordinator
      // serializes this pass and rechecks its exact authority when it runs.
      void this.resyncOwners(refreshed).catch(() => this.report("delivery resync after owner refresh failed; reconnect will retry"));
    }
    // Outcomes are only a response cache for current calls, not a second durable outbox.
    while (this.outcomes.size > 256) { const key = this.outcomes.keys().next().value; if (key === undefined) break; this.outcomes.delete(key); }
  }

  private markActedIds(record: LocalRecord, ids: string[]): void {
    const set = new Set(ids);
    for (const delivery of this.registry.pending(record.session.id ?? "")) if (set.has(delivery.message.id)) this.registry.acted(record, delivery.seq);
  }
  private async poll(peer: IpcPeer, record: LocalRecord, value: unknown): Promise<unknown> {
    const params = Poll.parse(value);
    if (params.event === "UserPromptSubmit") { record.stopBlocked = false; record.session.state = "active"; this.registry.save(record); }
    if (params.event === "Stop") { record.session.state = "idle"; this.registry.save(record); }
    if (params.event === "Stop" && (params.stop_hook_active || record.stopBlocked || record.session.wake === "off")) return { headers: [], cursor: 0, more: false, block: false, session: record.session };
    if (!record.session.id) throw new RpcError(-32021, "session registration is pending");
    const result = Results["inbox.list"].parse(await this.transport.request("inbox.list", { session_id: record.session.id, unread_only: true, waking_only: params.event === "Stop", limit: 200 }));
    const current = this.currentOwner(peer, record);
    const block = params.event === "Stop" && current.session.wake === "on" && !current.stopBlocked && result.headers.length > 0;
    if (block) { current.stopBlocked = true; current.session.state = "active"; this.registry.save(current); }
    return { ...result, block, session: current.session };
  }

  private async deliverPending(key: string): Promise<void> {
    const active = this.deliveryRuns.get(key);
    if (active) return active;
    const epoch = this.registry.get(key)?.lifecycleEpoch ?? 0;
    const run = this.performDelivery(key);
    this.deliveryRuns.set(key, run);
    try { await run; } finally {
      this.deliveryRuns.delete(key);
      const current = this.registry.get(key);
      // A wake arriving during an old lifecycle's pending delivery joins that run.
      // Once it drains, give the current lifecycle its own attempt without parallel sends.
      if (!this.closed && current && (current.lifecycleEpoch ?? 0) !== epoch && current.session.state !== "gone" &&
        current.session.wake === "on" && this.registry.hasPendingWake(current.session.id ?? "")) {
        this.wake.schedule(key, current.lastWake);
      }
    }
  }
  private async performDelivery(key: string): Promise<void> {
    let record = this.registry.get(key);
    if (!record?.session.id || record.session.state === "gone" || record.session.wake === "off" || !this.transport.connected) return;
    if (record.lastWake !== undefined && this.clock.now() < record.lastWake + this.wake.cooldown) { this.wake.schedule(key, record.lastWake); return; }
    const expected = { pid: record.pid, birth: record.processStartedAt, generation: record.ownerGeneration, epoch: record.lifecycleEpoch };
    const sameGeneration = (current: LocalRecord | undefined): current is LocalRecord => Boolean(current && current.session.state !== "gone" && current.pid === expected.pid && current.processStartedAt === expected.birth && current.ownerGeneration === expected.generation && current.lifecycleEpoch === expected.epoch);
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
    // Retained unknown legacy owners are not authority to use a native endpoint.
    // Probe after hub I/O and re-read the generation before any delivery bookkeeping.
    let birth: string | undefined;
    try { birth = expected.pid ? await (this.options.processStart ?? processStart)(expected.pid) : undefined; }
    catch { /* Unavailable process evidence leaves delivery pending and unread. */ }
    record = this.registry.get(key);
    if (!sameGeneration(record) || record.session.wake !== "on" || compareProcessBirth(birth, expected.birth) !== "same") return;
    for (const delivery of pending) if (!unread.has(delivery.message.id)) this.registry.acted(record, delivery.seq);
    const qualifying = pending.filter((delivery) => unread.has(delivery.message.id));
    const selected = qualifying[0];
    if (!selected) return;
    // A vendor conversation can expose one socket to multiple resumed owners. Never
    // route private traffic through that ambiguous native endpoint; hooks remain isolated.
    const endpointOwner = record;
    if (endpointOwner.session.vendor === "claude-code" && endpointOwner.endpoint && this.registry.all().some(other =>
      other.key !== endpointOwner.key && other.session.state !== "gone" && other.session.vendor === "claude-code" &&
      other.session.vendor_session_id === endpointOwner.session.vendor_session_id && other.endpoint === endpointOwner.endpoint)) return;
    const result = await this.adapter(record).deliver(record, selected.message, true);
    if (result.outcome === "inbox") return;
    record = this.registry.get(key);
    if (!sameGeneration(record)) return;
    record.lastWake = this.clock.now();
    this.registry.save(record);
    if (result.outcome === "rejected") this.report("vendor rejected or held a native message; delivery remains unread");
    // One attempt covers the coalesced batch; all bodies remain available in the inbox.
    for (const delivery of qualifying) this.registry.acted(record, delivery.seq);
    if (result.outcome === "accepted") await this.write(record, "receipt.mark", { ids: [selected.message.id], state: "read" });
    const remaining = this.registry.pending(record.session.id ?? "").some((delivery) => delivery.wake);
    if (remaining) this.wake.schedule(key, record.lastWake);
  }

  private async statusForCaller(caller: z.infer<typeof DaemonStatusParams>["caller"]) {
    if (!caller) return this.status();
    let recovery = caller.vendor === "codex" ? "Reconnect the current Codex root MCP shim, then call whoami; status does not register a session." : "Use /exit, then claude --resume with trusted hooks; waiting alone cannot repair an ended registration.";
    let birth: string | undefined;
    try { birth = await (this.options.processStart ?? processStart)(caller.pid); } catch { /* Report unverified. */ }
    const status = this.status();
    const records = this.registry.all().filter(record => record.session.vendor === caller.vendor &&
      record.pid === caller.pid && record.processStartedAt === caller.process_started_at);
    const matching = records.filter(record => record.session.vendor_session_id === caller.vendor_session_id &&
      record.ownerGeneration === caller.owner_generation);
    let state: "active" | "gone" | "unavailable" | "conflicting" | "unverified" = "unavailable";
    let record: LocalRecord | undefined;
    if (compareProcessBirth(birth, caller.process_started_at) === "unverified") state = "unverified";
    else if (birth !== caller.process_started_at || matching.length > 1 ||
      records.some(item => (item.ownerGeneration ?? 0) > (caller.owner_generation ?? 0))) state = "conflicting";
    else if (matching.length === 1) {
      record = matching[0];
      state = record?.session.state === "gone" ? "gone" : "active";
    }
    if (state === "unverified") recovery = "Retry status; process ownership could not be verified. Inspect local diagnostics if this persists.";
    else if (state === "gone" && record?.goneReason === "liveness" && (record.ownerGeneration ?? 0) > 0) {
      recovery = "The next current hook or whoami call can restore this liveness-retired registration after verifying process ownership.";
    }
    const issues = state === "active" ? status.health.issues : [...status.health.issues, `Caller registration is ${state}. ${recovery}`];
    return { ...status, health: { state: issues.length ? "degraded" : "healthy", issues }, caller: {
      state, ...(record?.session.id ? { session_id: record.session.id } : {}),
      ...(state === "gone" ? { reason: record?.goneReason ?? "unknown" } : {}),
      ...(state === "active" ? {} : { recovery }),
    } };
  }

  status() {
    const outbox = this.registry.outbox();
    const issues = [
      ...(!this.transport.connected ? ["Hub disconnected; check kom doctor and kom logs."] : []),
      ...(outbox.some((entry) => entry.error) ? ["Outbox has blocked entries; inspect their error before deciding whether to resend."] : []),
    ];
    return {
      runtime_contract: RUNTIME_CONTRACT, daemon: { pid: process.pid, version: RELEASE_VERSION, running: true }, hub: { connected: this.transport.connected },
      health: { state: issues.length ? "degraded" : "healthy", issues },
      outbox_depth: outbox.length,
      outbox: outbox.map((entry) => ({ id: entry.id, method: entry.method, age_ms: Math.max(0, this.clock.now() - entry.created_at), error: entry.error })),
      sessions: this.registry.all().map((record) => ({ ...record.session, acked_seq: record.acked, ...(record.permissionMode ? { permission_mode: record.permissionMode } : {}), ...(record.inboundPolicy ? { inbound_policy: record.inboundPolicy } : {}) })),
      ...(this.lastError ? { last_error: this.lastError, last_error_at: this.lastErrorAt } : {}),
    };
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const waiter of this.operationWaiters.values()) waiter.cancel(new DaemonStoppingError());
    for (const listeners of this.registrationWaiters.values()) for (const cancel of listeners) cancel();
    this.wake.close();
    await this.transport.close();
    if (this.flushing) await this.flushing;
    await Promise.allSettled(this.deliveryRuns.values());
    this.registry.close();
  }
}
