import { afterEach, expect, it } from "vitest";
import { RESYNC_PAGE_CAPABILITY, Session } from "@kommutator/protocol";
import { Registry, type Delivery, type LocalRecord } from "../src/registry.js";
import { ResyncCoordinator } from "../src/resync.js";
import type { HubTransport } from "../src/hub-link.js";
const registries: Registry[] = [];
afterEach(() => registries.splice(0).forEach(r => r.close()));
function fixture() {
  const registry = new Registry(":memory:"); registries.push(registry);
  const record: LocalRecord = { key: "owner", session: Session.parse({ id: "receiver", host: "host", name: "receiver", vendor: "other" }),
    pid: 123, processStartedAt: "birth", ownerGeneration: 1, lifecycleEpoch: 0, acked: 0, stopBlocked: false };
  registry.save(record);
  const calls: Array<{ method: string; params: unknown }> = [];
  const transport: HubTransport & { epoch: number; connected: boolean; capabilities: string[] } = {
    connected: true, epoch: 1, capabilities: [RESYNC_PAGE_CAPABILITY],
    async request(method, params) { calls.push({ method, params }); return { session_id: "receiver", through: 0, cursor: 0, more: false, deliveries: [] }; },
    start() {}, async close() {},
  };
  let open = true; let wakes = 0;
  const coordinator = new ResyncCoordinator(transport, registry, () => open, (_record, deliveries) => {
    const fresh = registry.transaction(() => deliveries.filter(d => registry.receive(d)));
    wakes += fresh.filter(d => d.wake).length;
  });
  return { registry, record, transport, coordinator, calls, stop() { open = false; }, wakes: () => wakes };
}
function delivery(seq: number, id = "receiver"): Delivery {
  return { session_id: id, seq, wake: true, message: { id: `message-${seq}`, from: "sender@host", to: ["receiver@host"],
    body: "body", kind: "dm", priority: "normal", origin: "agent", force_wake: false, hops: 0, thread_id: `message-${seq}`,
    reply_to: null, created_at: "2026-11-14T00:00:00.000Z" } };
}
it("round-robins fixed highwaters, deduplicates interleaved push and preserves acted state", async () => {
  const f = fixture(); const second = { ...f.record, key: "second", session: { ...f.record.session, id: "second" } }; f.registry.save(second);
  const sequence: string[] = [];
  f.registry.receive(delivery(2));
  f.transport.request = async (_method, raw) => {
    const p = raw as { session_id: string; after: number; through?: number }; sequence.push(`${p.session_id}:${p.after}`);
    if (p.after > 0) expect(p.through).toBe(2);
    return { session_id: p.session_id, through: 2, cursor: p.after + 1, more: p.after === 0, deliveries: [delivery(p.after + 1, p.session_id)] };
  };
  await f.coordinator.run([f.record, second]);
  expect(sequence).toEqual(["receiver:0", "second:0", "receiver:1", "second:1"]);
  expect(f.registry.pending("receiver")).toHaveLength(2);
  expect(f.registry.get(f.record.key)?.acked).toBe(0);
  expect(f.wakes()).toBe(3);
});
it.each(["ended", "replacement", "epoch", "disconnect", "shutdown"])("discards late page after %s", async mode => {
  const f = fixture(); let release!: (value: unknown) => void;
  f.transport.request = () => new Promise(resolve => { release = resolve; });
  const run = f.coordinator.run([f.record]);
  if (mode === "ended") f.registry.save({ ...f.record, session: { ...f.record.session, state: "gone" } });
  if (mode === "replacement") f.registry.save({ ...f.record, ownerGeneration: 2 });
  if (mode === "epoch") f.transport.epoch++;
  if (mode === "disconnect") f.transport.connected = false;
  if (mode === "shutdown") f.stop();
  release({ session_id: "receiver", through: 1, cursor: 1, more: false, deliveries: [delivery(1)] });
  await run;
  expect(f.registry.pending("receiver")).toEqual([]); expect(f.wakes()).toBe(0);
});
it.each([
  { cursor: 0 }, { through: 0 }, { session_id: "foreign" }, { more: true, deliveries: [] },
  { deliveries: [delivery(1), delivery(1)] }, { deliveries: [delivery(1, "foreign")] },
])("rejects malformed page without partial ingestion: %j", async patch => {
  const f = fixture(); f.transport.request = async () => ({ session_id: "receiver", through: 1, cursor: 1, more: false, deliveries: [delivery(1)], ...patch });
  await expect(f.coordinator.run([f.record])).rejects.toThrow("invalid bounded resync page");
  expect(f.registry.pending("receiver")).toEqual([]);
});
it("uses explicit legacy compatibility only without capability", async () => {
  const f = fixture(); f.transport.capabilities = [];
  await f.coordinator.run([f.record]); expect(f.calls[0]?.method).toBe("deliveries.resync");
  f.transport.capabilities = [RESYNC_PAGE_CAPABILITY]; f.transport.request = async () => { throw new Error("method not found"); };
  await expect(f.coordinator.run([f.record])).rejects.toThrow("method not found");
  expect(f.calls).toHaveLength(1);
});
it("coalesces overlapping work and never overlaps page requests", async () => {
  const f = fixture(); let active = 0; let peak = 0; let count = 0;
  f.transport.request = async () => { peak = Math.max(peak, ++active); await Promise.resolve(); active--; count++;
    return { session_id: "receiver", through: 0, cursor: 0, more: false, deliveries: [] }; };
  await Promise.all([f.coordinator.run([f.record]), f.coordinator.run([f.record]), f.coordinator.run([f.record])]);
  expect(peak).toBe(1); expect(count).toBe(2);
});
it("restarts after a lost response from acted state, without duplicate wake", async () => {
  const f = fixture(); let lost = true; const afters: number[] = [];
  f.transport.request = async (_method, raw) => {
    const p = raw as { after: number }; afters.push(p.after);
    if (p.after === 1 && lost) { lost = false; throw new Error("response lost"); }
    return { session_id: "receiver", through: 2, cursor: p.after + 1, more: p.after === 0, deliveries: [delivery(p.after + 1)] };
  };
  await expect(f.coordinator.run([f.record])).rejects.toThrow("response lost");
  await f.coordinator.run([f.record]);
  expect(afters).toEqual([0, 1, 0, 1]);
  expect(f.registry.pending("receiver")).toHaveLength(2); expect(f.wakes()).toBe(2);
  expect(f.registry.get("owner")?.acked).toBe(0);
});
