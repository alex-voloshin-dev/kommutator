import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as z from "zod";
import { Session, Notifications } from "@kommutator/protocol";
import type { LocalSession } from "./adapters/types.js";

export const STATE_SCHEMA_VERSION = 2;
const execFileAsync = promisify(execFile);

/** Process birth time closes the PID-reuse hole in the adapter's existence probe. */
export async function processStart(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 1000, maxBuffer: 1024 });
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

const LocalRecordSchema = z.object({
  key: z.string(), session: Session.extend({ handle: z.string().optional() }),
  ownerGeneration: z.number().int().positive().optional(),
  pid: z.number().optional(), processStartedAt: z.string().optional(),
  endpoint: z.string().optional(), token: z.string().optional(), permissionMode: z.string().optional(),
  inboundPolicy: z.enum(["default", "accept", "hold", "refuse"]).optional(),
  acked: z.number().int().nonnegative().default(0),
  lastWake: z.number().optional(), stopBlocked: z.boolean().default(false),
});
export interface LocalRecord extends LocalSession {
  key: string;
  ownerGeneration?: number;
  session: z.infer<typeof LocalRecordSchema>["session"];
  acked: number;
  lastWake?: number;
  stopBlocked: boolean;
}
const OutboxRow = z.object({
  id: z.number(), local_key: z.string(), method: z.string(), params: z.string(), created_at: z.number(),
  error: z.string().nullable(),
});
export type OutboxEntry = z.infer<typeof OutboxRow>;
export type Delivery = z.infer<typeof Notifications.deliver>;

/** One restricted SQLite file contains identity, replay keys and wake work. */
export class Registry {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    const version = z.object({ user_version: z.number() }).parse(this.db.prepare("PRAGMA user_version").get()).user_version;
    if (version !== 0 && version !== 1 && version !== STATE_SCHEMA_VERSION) { this.db.close(); throw new Error("unsupported agentd state schema"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (local_key TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, local_key TEXT NOT NULL, method TEXT NOT NULL,
        params TEXT NOT NULL, created_at INTEGER NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        session_id TEXT NOT NULL, seq INTEGER NOT NULL, notification TEXT NOT NULL,
        acted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id, seq)
      );
      PRAGMA user_version = ${STATE_SCHEMA_VERSION};
    `);
  }
  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = run(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  all(): LocalRecord[] {
    return this.db.prepare("SELECT record FROM sessions").all().map((row) => {
      const value = LocalRecordSchema.parse(JSON.parse(z.object({ record: z.string() }).parse(row).record));
      return {
        key: value.key, session: value.session, acked: value.acked, stopBlocked: value.stopBlocked,
        ...(value.ownerGeneration !== undefined ? { ownerGeneration: value.ownerGeneration } : {}),
        ...(value.pid !== undefined ? { pid: value.pid } : {}),
        ...(value.processStartedAt !== undefined ? { processStartedAt: value.processStartedAt } : {}),
        ...(value.endpoint !== undefined ? { endpoint: value.endpoint } : {}),
        ...(value.token !== undefined ? { token: value.token } : {}),
        ...(value.permissionMode !== undefined ? { permissionMode: value.permissionMode } : {}),
        ...(value.inboundPolicy !== undefined ? { inboundPolicy: value.inboundPolicy } : {}),
        ...(value.lastWake !== undefined ? { lastWake: value.lastWake } : {}),
      };
    });
  }
  get(key: string): LocalRecord | undefined { return this.all().find((r) => r.key === key); }
  byId(id: string): LocalRecord | undefined { return this.all().find((r) => r.session.id === id); }
  save(record: LocalRecord): void {
    this.db.prepare("INSERT INTO sessions(local_key,record) VALUES(?,?) ON CONFLICT(local_key) DO UPDATE SET record=excluded.record").run(record.key, JSON.stringify(record));
  }
  enqueue(key: string, method: string, params: unknown, now: number): number {
    return Number(this.db.prepare("INSERT INTO outbox(local_key,method,params,created_at) VALUES(?,?,?,?)").run(key, method, JSON.stringify(params), now).lastInsertRowid);
  }
  outbox(): OutboxEntry[] { return this.db.prepare("SELECT * FROM outbox ORDER BY id").all().map((row) => OutboxRow.parse(row)); }
  outboxEntry(id: number): OutboxEntry | undefined {
    const row = this.db.prepare("SELECT * FROM outbox WHERE id=?").get(id);
    return row ? OutboxRow.parse(row) : undefined;
  }
  updateParams(id: number, params: unknown): void { this.db.prepare("UPDATE outbox SET params=? WHERE id=?").run(JSON.stringify(params), id); }
  remove(id: number): void { this.db.prepare("DELETE FROM outbox WHERE id=?").run(id); }
  fail(id: number, reason: string): void { this.db.prepare("UPDATE outbox SET error=? WHERE id=?").run(reason, id); }
  receive(delivery: Delivery): boolean {
    return this.db.prepare("INSERT OR IGNORE INTO deliveries(session_id,seq,notification) VALUES(?,?,?)").run(delivery.session_id, delivery.seq, JSON.stringify(delivery)).changes === 1;
  }
  pending(id: string): Delivery[] {
    return this.db.prepare("SELECT notification FROM deliveries WHERE session_id=? AND acted=0 ORDER BY seq").all(id)
      .map((row) => Notifications.deliver.parse(JSON.parse(z.object({ notification: z.string() }).parse(row).notification)));
  }
  acted(record: LocalRecord, seq: number): void {
    this.transaction(() => {
      record = this.get(record.key) ?? record;
      this.db.prepare("UPDATE deliveries SET acted=1 WHERE session_id=? AND seq=?").run(record.session.id ?? "", seq);
      // Missing/read-before-received sequence numbers can conservatively hold the cursor
      // back. Durable per-sequence dedupe still prevents duplicate native attempts.
      const rows = this.db.prepare("SELECT seq,acted FROM deliveries WHERE session_id=? AND seq>? ORDER BY seq").all(record.session.id ?? "", record.acked);
      for (const row of rows) {
        const next = z.object({ seq: z.number(), acted: z.number() }).parse(row);
        if (next.seq !== record.acked + 1 || next.acted !== 1) break;
        record.acked = next.seq;
      }
      this.save(record);
    });
  }
  close(): void { this.db.close(); }
}
