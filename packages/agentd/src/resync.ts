import { RESYNC_PAGE_BYTES, RESYNC_PAGE_CAPABILITY, Results } from "@kommutator/protocol";
import type { HubTransport } from "./hub-link.js";
import type { Delivery, LocalRecord, Registry } from "./registry.js";
import { RpcError } from "./errors.js";

// Mutable policy/status/acked fields are intentionally excluded; authority is not.
function owner(record: LocalRecord): string {
  return JSON.stringify([record.key, record.session.id, record.pid, record.processStartedAt,
    record.ownerGeneration, record.lifecycleEpoch, record.session.vendor, record.session.vendor_session_id,
    record.session.incarnation, record.session.cwd, record.session.project_key, record.endpoint, record.token]);
}
interface Scan { record: LocalRecord; epoch: number; after: number; through?: number }

/** One in-flight request, round-robin finite highwaters, no flush or receipt side effects. */
export class ResyncCoordinator {
  private readonly pending = new Map<string, Scan>();
  private running: Promise<void> | undefined;
  constructor(private readonly transport: HubTransport, private readonly registry: Registry,
    private readonly open: () => boolean, private readonly ingest: (record: LocalRecord, deliveries: Delivery[]) => void) {}

  current(expected: LocalRecord): LocalRecord | undefined {
    const current = this.registry.get(expected.key);
    return this.open() && current?.session.id && current.session.state !== "gone" &&
      owner(current) === owner(expected) ? current : undefined;
  }

  run(records: LocalRecord[]): Promise<void> {
    if (!this.open()) return Promise.resolve();
    for (const record of records) {
      if (this.current(record)) this.pending.set(record.key, { record, epoch: this.transport.epoch ?? 0, after: record.acked });
    }
    if (!this.running) this.running = this.drain().finally(() => { this.running = undefined; });
    return this.running;
  }

  private valid(scan: Scan): boolean {
    return this.transport.connected && scan.epoch === (this.transport.epoch ?? 0) && this.current(scan.record) !== undefined;
  }

  private async drain(): Promise<void> {
    while (this.open() && this.pending.size > 0) {
      const scans = [...this.pending.values()];
      this.pending.clear();
      while (scans.length > 0 && this.open()) {
        const scan = scans.shift();
        if (!scan || !this.valid(scan)) continue;
        const id = scan.record.session.id;
        if (!id) continue;
        try {
          if (!this.transport.capabilities?.includes(RESYNC_PAGE_CAPABILITY)) {
            await this.transport.request("deliveries.resync", { acked: { [id]: scan.after } });
            continue;
          }
          const raw = await this.transport.request("deliveries.resync.page", {
            session_id: id, after: scan.after, ...(scan.through === undefined ? {} : { through: scan.through }),
          });
          if (!this.valid(scan)) continue;
          const parsed = Results["deliveries.resync.page"].safeParse(raw);
          if (!parsed.success || Buffer.byteLength(JSON.stringify(raw)) > RESYNC_PAGE_BYTES) throw this.invalid();
          const page = parsed.data;
          if (page.session_id !== id || page.through < scan.after || page.cursor < scan.after || page.cursor > page.through ||
            (scan.through !== undefined && page.through !== scan.through) ||
            (page.more ? page.deliveries.length === 0 || page.cursor <= scan.after || page.cursor !== page.deliveries.at(-1)?.seq : page.cursor !== page.through)) throw this.invalid();
          let previous = scan.after;
          for (const delivery of page.deliveries) {
            if (delivery.session_id !== id || delivery.seq <= previous || delivery.seq > page.cursor) throw this.invalid();
            previous = delivery.seq;
          }
          this.ingest(scan.record, page.deliveries);
          scan.after = page.cursor;
          scan.through = page.through;
          if (page.more) scans.push(scan);
        } catch (error) {
          if (!this.valid(scan)) continue;
          this.pending.clear();
          throw error;
        }
      }
    }
    this.pending.clear();
  }

  private invalid(): RpcError { return new RpcError(-32011, "invalid bounded resync page"); }
}
