import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@kommutator/protocol";
import type { HubEvents } from "./events.js";

export class RpcFault extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "RpcFault";
  }
}

export const errors = { invalidParams: -32602, unauthorized: -32001, notFound: -32004, conflict: -32009, pending: -32010 } as const;

export function rejectRetiredOperation(ctx: HubContext, kind: "registration" | "message" | "board", key: string): void {
  if (ctx.db.prepare("SELECT 1 FROM retired_operations WHERE kind = ? AND operation_key = ?").get(kind, key)) {
    throw new RpcFault(errors.conflict, "operation was permanently removed by operator cleanup");
  }
}

/** One authenticated host connection. Only hello may set its host. */
export interface HubPeer { host?: string }

export interface HubContext {
  db: DatabaseSync;
  events: HubEvents;
  now: () => string;
  newId: () => string;
}

export function defaultId(): string { return randomUUID(); }

export interface SessionRow {
  id: string;
  host: string;
  handle: string;
  name: string;
  requested_name: string | null;
  role: string | null;
  vendor: Session["vendor"];
  vendor_session_id: string | null;
  cwd: string | null;
  project_key: string | null;
  state: Session["state"];
  status_line: string | null;
  incarnation: number;
  wake: Session["wake"];
  capability: Session["capability"];
  reg_id: string;
  next_seq: number;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
}

export function requireHost(peer: HubPeer): string {
  if (!peer.host) throw new RpcFault(errors.unauthorized, "hello required");
  return peer.host;
}

export function requireSession(ctx: HubContext, peer: HubPeer, id: string, allowEnded = false): SessionRow {
  const host = requireHost(peer);
  const row = ctx.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row || row.host !== host) throw new RpcFault(errors.unauthorized, "session does not belong to this host");
  if (row.ended_at !== null && !allowEnded) throw new RpcFault(errors.notFound, "session is gone");
  return row;
}

export function requireMembership(ctx: HubContext, sessionId: string, topic: string): number {
  const row = ctx.db.prepare(`SELECT t.id FROM topics t JOIN memberships m ON m.topic_id = t.id
    WHERE m.session_id = ? AND t.name = ?`).get(sessionId, topic) as { id: number } | undefined;
  if (!row) throw new RpcFault(errors.unauthorized, "topic membership required");
  return row.id;
}

/** Domain handlers own one synchronous transaction; notifications follow commit. */
export function transaction<T>(ctx: HubContext, fn: () => T): T {
  ctx.db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    ctx.db.exec("COMMIT");
    return result;
  } catch (error) {
    ctx.db.exec("ROLLBACK");
    throw error;
  }
}
