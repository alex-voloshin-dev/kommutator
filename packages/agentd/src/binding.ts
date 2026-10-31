import type { LocalRecord } from "./registry.js";
import { RpcError } from "./errors.js";

export interface BindingFacts { vendor?: string | undefined; vendor_session_id?: string | undefined; ppid?: number | undefined; cwd?: string | undefined }

export function resolveBinding(facts: BindingFacts, records: LocalRecord[], boundKeys: ReadonlySet<string>): LocalRecord {
  const live = records.filter((r) => r.session.state !== "gone" && (!facts.vendor || r.session.vendor === facts.vendor));
  if (facts.vendor_session_id) {
    const exact = live.filter((r) => r.session.vendor_session_id === facts.vendor_session_id);
    if (exact.length === 1 && exact[0]) return exact[0];
    throw new RpcError(-32020, "vendor session is not registered yet; waiting for its hook");
  }
  const parent = facts.ppid ? live.filter((r) => r.pid === facts.ppid) : [];
  if (parent.length === 1 && parent[0]) return parent[0];
  if (parent.length > 1) throw new RpcError(-32020, "ambiguous parent process; provide vendor_session_id");
  const cwd = facts.cwd ? live.filter((r) => r.session.cwd === facts.cwd && !boundKeys.has(r.key)) : [];
  if (cwd.length === 1 && cwd[0]) return cwd[0];
  throw new RpcError(-32020, "ambiguous or unknown session; provide vendor_session_id");
}
