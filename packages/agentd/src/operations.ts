import * as z from "zod";
import { OperationStatus, OperationError, Results } from "@kommutator/protocol";
import { RpcError } from "./errors.js";
import type { Registry, LocalRecord } from "./registry.js";

export const OBSERVATION_LIMIT = 4096;
export const OWNER_CONFIRMATION_LIMIT = 256;
export const OBSERVATION_TTL = 24 * 60 * 60 * 1000;
export const RESULT_BYTES = 65_536;
export interface OperationOwner { facts: string; sessionId?: string }
export function operationOwner(record: LocalRecord): OperationOwner {
  return { facts: JSON.stringify([record.key, record.session.vendor, record.session.vendor_session_id ?? null,
    record.pid ?? null, record.processStartedAt ?? null, record.ownerGeneration ?? null, record.lifecycleEpoch ?? 0]),
    ...(record.session.id ? { sessionId: record.session.id } : {}) };
}
export function matchesOwner(owner: OperationOwner, record: LocalRecord): boolean {
  const current = operationOwner(record);
  return owner.facts === current.facts && (owner.sessionId === undefined || owner.sessionId === current.sessionId);
}
const Row = z.object({ operation_id: z.string(), owner: z.string(), session_id: z.string().nullable(),
  method: z.enum(["message.send", "receipt.mark"]), outbox_id: z.number(), created_at: z.number(), observed_at: z.number(),
  outcome: z.enum(["queued", "blocked", "confirmed"]), result: z.string().nullable(), error: z.string().nullable() });

/** Diagnostic evidence only; the outbox remains the sole replay authority. */
export class Operations {
  constructor(private readonly registry: Registry) {}
  prune(now: number): void {
    this.registry.db.prepare(`DELETE FROM mutation_observations WHERE outcome='confirmed'
      AND observed_at<=? AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.id=mutation_observations.outbox_id)`)
      .run(now - OBSERVATION_TTL);
    this.registry.db.prepare(`DELETE FROM mutation_observations WHERE operation_id IN (
      SELECT operation_id FROM (
        SELECT operation_id, ROW_NUMBER() OVER (PARTITION BY owner ORDER BY observed_at DESC, outbox_id DESC) AS position
        FROM mutation_observations WHERE outcome='confirmed'
        AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.id=mutation_observations.outbox_id)
      ) WHERE position>?)`).run(OWNER_CONFIRMATION_LIMIT);
  }
  admit(id: string, record: LocalRecord, method: "message.send" | "receipt.mark", params: unknown, now: number): number {
    return this.registry.transaction(() => {
      // Check retained collisions before retention can erase their evidence.
      if (this.registry.db.prepare("SELECT 1 FROM mutation_observations WHERE operation_id=?").get(id)) throw new RpcError(-32602, "operation correlation already retained; never resubmit it");
      this.prune(now);
      const count = z.object({ count: z.number() }).parse(this.registry.db.prepare("SELECT COUNT(*) AS count FROM mutation_observations").get()).count;
      if (count >= OBSERVATION_LIMIT) {
        const oldest = this.registry.db.prepare(`SELECT operation_id FROM mutation_observations WHERE outcome='confirmed'
          AND NOT EXISTS (SELECT 1 FROM outbox WHERE outbox.id=mutation_observations.outbox_id)
          ORDER BY observed_at, outbox_id LIMIT 1`).get();
        if (!oldest) throw new RpcError(-32022, "operation observation capacity reached before admission");
        this.registry.db.prepare("DELETE FROM mutation_observations WHERE operation_id=?").run(z.object({ operation_id: z.string() }).parse(oldest).operation_id);
      }
      const outbox = this.registry.enqueue(record.key, method, params, now);
      const owner = operationOwner(record);
      this.registry.db.prepare("INSERT INTO mutation_observations VALUES(?,?,?,?,?,?,?,?,NULL,NULL)")
        .run(id, owner.facts, owner.sessionId ?? null, method, outbox, now, now, "queued");
      return outbox;
    });
  }
  attach(record: LocalRecord): void {
    if (!record.session.id) return;
    this.registry.db.prepare("UPDATE mutation_observations SET session_id=? WHERE owner=? AND session_id IS NULL")
      .run(record.session.id, operationOwner(record).facts);
  }
  confirm(outbox: number, result: unknown, now: number): boolean {
    const raw = this.registry.db.prepare("SELECT method FROM mutation_observations WHERE outbox_id=?").get(outbox);
    if (!raw) return false;
    const row = z.object({ method: z.enum(["message.send", "receipt.mark"]) }).parse(raw);
    let value: unknown = row.method === "message.send" ? Results["message.send"].parse(result) : Results["receipt.mark"].parse(result);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > RESULT_BYTES) {
      const send = Results["message.send"].parse(value);
      value = { id: send.id, replayed: send.replayed, deliveries_omitted: true };
    }
    this.registry.db.prepare("UPDATE mutation_observations SET outcome='confirmed',result=?,error=NULL,observed_at=? WHERE outbox_id=?")
      .run(JSON.stringify(value), now, outbox);
    return true;
  }
  block(outbox: number, error: z.infer<typeof OperationError>, now: number): void {
    this.registry.db.prepare("UPDATE mutation_observations SET outcome='blocked',error=?,observed_at=? WHERE outbox_id=?")
      .run(JSON.stringify(OperationError.parse(error)), now, outbox);
  }
  status(id: string, record: LocalRecord, now: number): OperationStatus {
    const unknown: OperationStatus = { operation_id: id, outcome: "unknown" };
    const raw = this.registry.db.prepare("SELECT * FROM mutation_observations WHERE operation_id=?").get(id);
    if (!raw) return unknown;
    const row = Row.parse(raw);
    if (row.owner !== operationOwner(record).facts || row.session_id !== (record.session.id ?? null)) return unknown;
    if (row.outcome === "confirmed" && now - row.observed_at >= OBSERVATION_TTL) return unknown;
    if (row.outcome !== "confirmed") {
      const queued = this.registry.outboxEntry(row.outbox_id);
      if (!queued || queued.local_key !== record.key || queued.method !== row.method) return unknown;
    }
    return OperationStatus.parse({ operation_id: id, method: row.method, created_at: row.created_at,
      observed_at: row.observed_at, outcome: row.outcome,
      ...(row.result ? { result: JSON.parse(row.result) } : {}), ...(row.error ? { error: JSON.parse(row.error) } : {}) });
  }
}
