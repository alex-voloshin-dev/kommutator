import { Methods, PROTOCOL_VERSION, RegisteredSession as RegisteredSessionSchema, TopicName, type Session } from "@kommutator/protocol";
import type { z } from "zod";
import {
  errors, requireHost, requireMembership, requireSession, RpcFault, transaction,
  type HubContext, type HubPeer, type SessionRow,
} from "./context.js";

export type RegisteredSession = Session & { id: string; handle: string };
type UpsertParams = z.output<typeof Methods["session.upsert"]>;
type RegisterParams = Extract<UpsertParams, { op: "register" }>;
type UpdateParams = Extract<UpsertParams, { op: "update" }>;
type ReincarnateParams = Extract<UpsertParams, { op: "reincarnate" }>;

interface RegistrationRow {
  session_id: string;
  op: "register" | "reincarnate";
  session_json: string;
}

interface UpsertResult {
  session: RegisteredSession;
  replayed: boolean;
}

function sessionRecord(row: SessionRow): RegisteredSession {
  return {
    id: row.id, host: row.host, handle: row.handle, name: row.name, vendor: row.vendor,
    state: row.state, incarnation: row.incarnation, wake: row.wake, capability: row.capability,
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.vendor_session_id === null ? {} : { vendor_session_id: row.vendor_session_id }),
    ...(row.cwd === null ? {} : { cwd: row.cwd }),
    ...(row.project_key === null ? {} : { project_key: row.project_key }),
    ...(row.status_line === null ? {} : { status_line: row.status_line }),
  };
}

export function hello(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["hello"]>) {
  if (peer.host !== undefined && peer.host !== params.host) {
    throw new RpcFault(errors.unauthorized, "connection is already bound to another host");
  }
  ctx.db.prepare(`INSERT INTO hosts(name, agentd_version, last_seen_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET agentd_version = excluded.agentd_version,
    last_seen_at = excluded.last_seen_at`).run(params.host, params.agentd_version, ctx.now());
  peer.host = params.host;
  if (params.protocol_version !== PROTOCOL_VERSION) {
    console.warn(`hub protocol version ${PROTOCOL_VERSION} differs from host ${params.host}: ${params.protocol_version}`);
  }
  return { host: params.host, protocol_version: PROTOCOL_VERSION };
}

function availableName(ctx: HubContext, host: string, requested: string, ownId: string | null = null): string {
  const occupied = ctx.db.prepare(`SELECT 1 FROM sessions WHERE handle = ? AND ended_at IS NULL
    AND (? IS NULL OR id != ?)`);
  let name = requested;
  for (let suffix = 2; occupied.get(`${name}@${host}`, ownId, ownId); suffix++) {
    const tail = `-${suffix}`;
    name = `${requested.slice(0, 63 - tail.length)}${tail}`;
  }
  return name;
}

function registrationReplay(ctx: HubContext, peer: HubPeer, params: RegisterParams | ReincarnateParams): UpsertResult | undefined {
  const row = ctx.db.prepare("SELECT session_id, op, session_json FROM session_registrations WHERE reg_id = ?")
    .get(params.reg_id) as RegistrationRow | undefined;
  if (!row) return undefined;
  requireSession(ctx, peer, row.session_id, true);
  if (row.op !== params.op || (params.op === "reincarnate" && params.session.id !== row.session_id)) {
    throw new RpcFault(errors.conflict, "registration key belongs to another operation or session");
  }
  return { session: RegisteredSessionSchema.parse(JSON.parse(row.session_json)), replayed: true };
}

function recordRegistration(ctx: HubContext, params: RegisterParams | ReincarnateParams, session: RegisteredSession): UpsertResult {
  ctx.db.prepare("INSERT INTO session_registrations(reg_id, session_id, op, session_json) VALUES (?, ?, ?, ?)")
    .run(params.reg_id, session.id, params.op, JSON.stringify(session));
  return { session, replayed: false };
}

function registerSession(ctx: HubContext, peer: HubPeer, params: RegisterParams): UpsertResult {
  const replay = registrationReplay(ctx, peer, params);
  if (replay) return replay;
  const session = params.session;
  const projectTopic = session.project_key === undefined ? undefined : `project:${session.project_key}`;
  if (projectTopic !== undefined && !TopicName.safeParse(projectTopic).success) {
    throw new RpcFault(errors.invalidParams, "project_key produces a topic longer than the topic name limit");
  }
  const name = availableName(ctx, session.host, session.name);
  const id = ctx.newId();
  const now = ctx.now();
  ctx.db.prepare(`INSERT INTO sessions(id, host, handle, name, requested_name, role, vendor, vendor_session_id,
    cwd, project_key, state, status_line, incarnation, wake, capability, reg_id, started_at, last_seen_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`)
    .run(id, session.host, `${name}@${session.host}`, name, session.name, session.role ?? null,
      session.vendor, session.vendor_session_id ?? null, session.cwd ?? null, session.project_key ?? null,
      session.state, session.status_line ?? null, session.wake, session.capability, params.reg_id, now, now,
      session.state === "gone" ? now : null);
  const join = ctx.db.prepare(`INSERT INTO memberships(session_id, topic_id)
    SELECT ?, id FROM topics WHERE name = ?`);
  join.run(id, "global");
  if (projectTopic !== undefined) {
    ctx.db.prepare("INSERT OR IGNORE INTO topics(name, kind, project_key) VALUES (?, 'project', ?)")
      .run(projectTopic, session.project_key ?? null);
    join.run(id, projectTopic);
  }
  return recordRegistration(ctx, params, sessionRecord(requireSession(ctx, peer, id, true)));
}

function updateSession(ctx: HubContext, peer: HubPeer, params: UpdateParams): UpsertResult {
  const current = requireSession(ctx, peer, params.session.id);
  const fields = params.session;
  const requested = fields.name ?? current.requested_name ?? current.name;
  const name = requested === (current.requested_name ?? current.name)
    ? current.name : availableName(ctx, current.host, requested, current.id);
  const role = fields.role ?? current.role;
  const statusLine = fields.status_line ?? current.status_line;
  const wake = fields.wake ?? current.wake;
  const capability = fields.capability ?? current.capability;
  if (name === current.name && requested === current.requested_name && role === current.role
    && statusLine === current.status_line && wake === current.wake && capability === current.capability) {
    return { session: sessionRecord(current), replayed: true };
  }
  ctx.db.prepare(`UPDATE sessions SET name = ?, handle = ?, requested_name = ?, role = ?, status_line = ?, wake = ?, capability = ?
    WHERE id = ?`).run(name, `${name}@${current.host}`, requested, role, statusLine, wake, capability, current.id);
  return { session: sessionRecord(requireSession(ctx, peer, current.id)), replayed: false };
}

function reincarnateSession(ctx: HubContext, peer: HubPeer, params: ReincarnateParams): UpsertResult {
  const current = requireSession(ctx, peer, params.session.id, true);
  const replay = registrationReplay(ctx, peer, params);
  if (replay) return replay;
  const occupied = ctx.db.prepare("SELECT 1 FROM sessions WHERE handle = ? AND ended_at IS NULL AND id != ?")
    .get(current.handle, current.id);
  const name = occupied ? availableName(ctx, current.host, current.requested_name ?? current.name, current.id) : current.name;
  ctx.db.prepare(`UPDATE sessions SET incarnation = incarnation + 1, reg_id = ?, state = 'active', ended_at = NULL,
    last_seen_at = ?, name = ?, handle = ? WHERE id = ?`)
    .run(params.reg_id, ctx.now(), name, `${name}@${current.host}`, current.id);
  return recordRegistration(ctx, params, sessionRecord(requireSession(ctx, peer, current.id)));
}

export function upsertSession(ctx: HubContext, peer: HubPeer, params: UpsertParams): UpsertResult {
  const host = requireHost(peer);
  if (params.op !== "update" && params.session.host !== host) {
    throw new RpcFault(errors.unauthorized, "session host does not match connection");
  }
  const result = transaction(ctx, () => {
    switch (params.op) {
      case "register": return registerSession(ctx, peer, params);
      case "update": return updateSession(ctx, peer, params);
      case "reincarnate": return reincarnateSession(ctx, peer, params);
    }
  });
  if (!result.replayed) {
    ctx.events.publish(params.op === "update" ? "session.updated" : "session.registered", { session: result.session });
  }
  return result;
}

export function heartbeatSession(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["session.heartbeat"]>) {
  transaction(ctx, () => {
    requireSession(ctx, peer, params.session_id);
    if (params.state === "gone") {
      throw new RpcFault(errors.invalidParams, "use session.gone with an incarnation to end a session");
    }
    ctx.db.prepare("UPDATE sessions SET state = ?, last_seen_at = ? WHERE id = ?")
      .run(params.state, ctx.now(), params.session_id);
  });
  ctx.events.publish("session.heartbeat", params);
  return { ok: true as const };
}

export function goneSession(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["session.gone"]>) {
  const changed = transaction(ctx, () => {
    const session = requireSession(ctx, peer, params.session_id, true);
    if (params.incarnation < session.incarnation) return false;
    if (params.incarnation > session.incarnation) {
      throw new RpcFault(errors.conflict, "gone incarnation is newer than the registered session");
    }
    if (session.ended_at !== null) return false;
    const now = ctx.now();
    ctx.db.prepare("UPDATE sessions SET state = 'gone', ended_at = ?, last_seen_at = ? WHERE id = ?")
      .run(now, now, session.id);
    return true;
  });
  if (changed) ctx.events.publish("session.gone", params);
  return { ok: true as const };
}

export function listSessions(ctx: HubContext, peer: HubPeer, params: z.output<typeof Methods["session.list"]>) {
  requireSession(ctx, peer, params.session_id);
  if (params.topic !== undefined) requireMembership(ctx, params.session_id, params.topic);
  const rows = ctx.db.prepare(`SELECT s.* FROM sessions s WHERE EXISTS (
      SELECT 1 FROM memberships own JOIN memberships other ON own.topic_id = other.topic_id
      JOIN topics t ON t.id = own.topic_id
      WHERE own.session_id = ? AND other.session_id = s.id AND (? IS NULL OR t.name = ?)
    ) AND (? IS NULL OR s.role = ?) AND ((? IS NULL AND s.state != 'gone') OR s.state = ?)
    ORDER BY s.handle, s.id`)
    .all(params.session_id, params.topic ?? null, params.topic ?? null, params.role ?? null,
      params.role ?? null, params.state ?? null, params.state ?? null) as unknown as SessionRow[];
  return { sessions: rows.map(sessionRecord) };
}
