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
