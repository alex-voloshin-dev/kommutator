function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Presentation-only projections: authorization and receipts remain with the RPC caller. */
export function compactStatus(result: unknown): unknown {
  if (!record(result)) return result;
  const { sessions, outbox, ...summary } = result;
  if (Array.isArray(sessions)) {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      const state = record(session) && typeof session.state === "string" ? session.state : "unknown";
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    summary.session_counts = { total: sessions.length, by_state: Object.fromEntries(counts) };
  } else if (sessions !== undefined) summary.sessions = sessions;
  if (Array.isArray(outbox)) {
    summary.outbox_summary = {
      total: outbox.length,
      blocked: outbox.filter(entry => record(entry) && Boolean(entry.error)).length,
      oldest_age_ms: outbox.reduce<number>((oldest, entry) => record(entry) && typeof entry.age_ms === "number" && Number.isFinite(entry.age_ms)
        ? Math.max(oldest, entry.age_ms) : oldest, 0),
    };
  } else if (outbox !== undefined) summary.outbox = outbox;
  return summary;
}

export function compactBoardPut(result: unknown): unknown {
  if (!record(result) || !record(result.entry)) return result;
  const { body: _body, ...entry } = result.entry;
  return { ...result, entry };
}

export function compactSessions(result: unknown): unknown {
  if (!record(result) || !Array.isArray(result.sessions)) return result;
  const fields = ["id", "handle", "vendor_session_id", "vendor", "host", "role", "state", "status_line"];
  return { ...result, sessions: result.sessions.map(session => record(session)
    ? Object.fromEntries(fields.filter(field => Object.hasOwn(session, field)).map(field => [field, session[field]]))
    : session) };
}

export function withoutInboxPreviews(result: unknown): unknown {
  if (!record(result) || !Array.isArray(result.headers)) return result;
  return { ...result, headers: result.headers.map(header => {
    if (!record(header)) return header;
    const { preview: _preview, ...rest } = header;
    return rest;
  }) };
}

/** Pure projection of the final wrapper result; it never initiates daemon recovery. */
export function statusHealthDetails(result: unknown): unknown {
  if (!record(result)) return result;
  const outbox = Array.isArray(result.outbox) ? result.outbox : undefined;
  const age = (entry: unknown): number | null => record(entry) && typeof entry.age_ms === "number"
    && Number.isFinite(entry.age_ms) && entry.age_ms >= 0 ? entry.age_ms : null;
  const oldest = (rows: unknown[] | undefined): number | null => {
    const ages = rows?.map(age).filter((value): value is number => value !== null);
    return ages?.length ? ages.reduce((maximum, value) => Math.max(maximum, value), 0) : null;
  };
  const blocked = outbox?.filter(entry => record(entry) && Boolean(entry.error));
  const examples = blocked ? [...blocked].sort((a, b) => (age(b) ?? -1) - (age(a) ?? -1)).slice(0, 5)
    .map(entry => ({ id: record(entry) && typeof entry.id === "number" ? entry.id : null,
      method: record(entry) && typeof entry.method === "string" ? entry.method.slice(0, 64) : null, age_ms: age(entry) })) : [];
  return { ...result, health_details: {
    connectivity: record(result.hub) && typeof result.hub.connected === "boolean"
      ? result.hub.connected ? "connected" : "disconnected" : "unknown",
    caller: record(result.caller) && typeof result.caller.state === "string" ? result.caller.state : "unverified",
    backlog: { total: outbox?.length ?? null, blocked: blocked?.length ?? null,
      oldest_age_ms: oldest(outbox), oldest_blocked_age_ms: oldest(blocked),
      warning: blocked?.length ? "Blocked work remains unresolved; inspect the detailed outbox and operation_status. Age does not prove a current outage, non-commit or safe resend." : null,
      examples, omitted: Math.max(0, (blocked?.length ?? 0) - examples.length) },
    last_error_at: (typeof result.last_error_at === "string" || typeof result.last_error_at === "number" && Number.isFinite(result.last_error_at)) ? result.last_error_at : null,
    last_error_evidence: "historical",
  } };
}
