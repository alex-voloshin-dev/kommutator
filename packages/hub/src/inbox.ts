import { RESYNC_PAGE_BYTES, RESYNC_PAGE_COUNT, makePreview, MessageHeader, type Methods, Notifications, Results } from "@kommutator/protocol";
import type { z } from "zod";
import { errors, requireHost, requireSession, RpcFault, transaction, type HubContext, type HubPeer } from "./context.js";
import { getStoredMessage } from "./routing.js";

interface HeaderRow {
  id: string;
  seq: number;
  sender_handle: string;
  kind: string;
  priority: string;
  subject: string | null;
  body: string;
  thread_id: string;
  created_at: string;
  state: "unread" | "read";
  wake: number;
}

export function listInbox(
  ctx: HubContext,
  peer: HubPeer,
  params: z.output<(typeof Methods)["inbox.list"]>,
): z.output<(typeof Results)["inbox.list"]> {
  requireSession(ctx, peer, params.session_id);
  const select = `SELECT m.id, d.seq, COALESCE(NULLIF(m.from_handle, ''), s.handle) AS sender_handle, m.kind, m.priority,
    m.subject, m.body, m.thread_id, m.created_at, d.state, d.wake FROM deliveries d
    JOIN messages m ON m.id = d.message_id JOIN sessions s ON s.id = m.from_session
    WHERE d.session_id = ? AND (? = 0 OR d.wake = 1)`;
  const rows = (params.unread_only
    ? ctx.db.prepare(`${select} AND d.state = 'unread' ORDER BY d.seq LIMIT ?`).all(params.session_id, Number(params.waking_only), params.limit + 1)
    : ctx.db.prepare(`${select} AND d.seq > ? ORDER BY d.seq LIMIT ?`).all(params.session_id, Number(params.waking_only), params.since_seq, params.limit + 1)
  ) as unknown as HeaderRow[];
  const headers = rows.slice(0, params.limit).map((row) => MessageHeader.parse({
    id: row.id,
    seq: row.seq,
    from: row.sender_handle,
    kind: row.kind,
    priority: row.priority,
    ...(row.subject === null ? {} : { subject: row.subject }),
    preview: makePreview(row.body),
    thread_id: row.thread_id,
    created_at: row.created_at,
    state: row.state,
    wake: row.wake === 1,
  }));
  return Results["inbox.list"].parse({
    headers,
    cursor: headers.at(-1)?.seq ?? (params.unread_only ? 0 : params.since_seq),
    more: rows.length > params.limit,
  });
}

export function readMessage(
  ctx: HubContext,
  peer: HubPeer,
  params: z.output<(typeof Methods)["message.read"]>,
): z.output<(typeof Results)["message.read"]> {
  const committed = transaction(ctx, () => {
    requireSession(ctx, peer, params.session_id);
    const delivery = ctx.db.prepare("SELECT state FROM deliveries WHERE message_id = ? AND session_id = ?")
      .get(params.id, params.session_id) as { state: "unread" | "read" } | undefined;
    if (!delivery) {
      const authored = ctx.db.prepare("SELECT 1 FROM messages WHERE id = ? AND from_session = ?")
        .get(params.id, params.session_id);
      if (!authored) throw new RpcFault(errors.notFound, "message is not in this session's inbox");
    }
    const message = getStoredMessage(ctx, params.id);
    if (!message) throw new RpcFault(errors.notFound, "message not found");
    if (delivery?.state === "unread") {
      ctx.db.prepare("UPDATE deliveries SET state = 'read', updated_at = ? WHERE message_id = ? AND session_id = ?")
        .run(ctx.now(), params.id, params.session_id);
    }
    return { result: Results["message.read"].parse({ message, state: "read" }), changed: delivery?.state === "unread" };
  });
  if (committed.changed) ctx.events.publish("delivery.read", {
    session_id: params.session_id, message_id: params.id, state: "read", cause: "read",
  });
  return committed.result;
}

export function markReceipt(
  ctx: HubContext,
  peer: HubPeer,
  params: z.output<(typeof Methods)["receipt.mark"]>,
): z.output<(typeof Results)["receipt.mark"]> {
  const committed = transaction(ctx, () => {
    requireSession(ctx, peer, params.session_id);
    const uniqueIds = new Set(params.ids);
    const counts = { requested: uniqueIds.size, matched: 0, marked_read: 0, already_read: 0, unmatched: 0 };
    const changed: string[] = [];
    const lookup = ctx.db.prepare("SELECT state FROM deliveries WHERE message_id = ? AND session_id = ?");
    const update = ctx.db.prepare(`UPDATE deliveries SET state = 'read', updated_at = ?
      WHERE message_id = ? AND session_id = ? AND state = 'unread'`);
    const now = ctx.now();
    for (const id of uniqueIds) {
      const delivery = lookup.get(id, params.session_id) as { state: "unread" | "read" } | undefined;
      if (!delivery) { counts.unmatched++; continue; }
      counts.matched++;
      if (delivery.state === "read") counts.already_read++;
      else if (params.state === "read" && update.run(now, id, params.session_id).changes > 0) {
        counts.marked_read++;
        changed.push(id);
      }
    }
    return { changed, result: Results["receipt.mark"].parse({ ok: true, counts }) };
  });
  for (const id of committed.changed) {
    ctx.events.publish("delivery.read", { session_id: params.session_id, message_id: id, state: "read", cause: "ack" });
  }
  return committed.result;
}

export function resyncDeliveries(
  ctx: HubContext,
  peer: HubPeer,
  params: z.output<(typeof Methods)["deliveries.resync"]>,
): { replayed: number } {
  const host = requireHost(peer);
  // Authorize the entire request before looking up or emitting any delivery.
  const sessions = Object.entries(params.acked).map(([id, acked]) => ({
    session: requireSession(ctx, peer, id), acked,
  }));
  const notifications: Array<z.output<(typeof Notifications)["deliver"]>> = [];
  for (const { session, acked } of sessions) {
    const rows = ctx.db.prepare(`SELECT message_id, seq, wake FROM deliveries
      WHERE session_id = ? AND state = 'unread' AND seq > ? ORDER BY seq`).all(session.id, acked) as unknown as Array<{
        message_id: string; seq: number; wake: number;
      }>;
    for (const row of rows) {
      const message = getStoredMessage(ctx, row.message_id);
      if (!message) throw new RpcFault(errors.notFound, "message not found");
      notifications.push(Notifications.deliver.parse({
        message, session_id: session.id, seq: row.seq, wake: row.wake === 1 && session.wake === "on",
      }));
    }
  }
  for (const notification of notifications) ctx.events.publish("deliver", { host, notification });
  return { replayed: notifications.length };
}

/** An independent observation cursor: never reads bodies or changes receipts. */
export function watchTopic(ctx: HubContext, peer: HubPeer,
  params: z.output<(typeof Methods)["watch.poll"]>): z.output<(typeof Results)["watch.poll"]> {
  return transaction(ctx, () => {
    const session = requireSession(ctx, peer, params.session_id, true);
    const member = ctx.db.prepare(`SELECT 1 FROM memberships x JOIN topics t ON t.id = x.topic_id
      WHERE x.session_id = ? AND t.name = ?`).get(params.session_id, params.topic);
    if (!member) throw new RpcFault(errors.unauthorized, "watch requires current topic membership");
    const paused = session.state === "gone" ? "gone" : session.wake === "off" ? "dnd" : undefined;
    if (paused) return { headers: [], more: false, state: paused, ...(params.since_seq === undefined ? {} : { cursor: params.since_seq }) };
    const highwater = (ctx.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM deliveries WHERE session_id = ?")
      .get(params.session_id) as { seq: number }).seq;
    if (params.since_seq === undefined) return { headers: [], cursor: highwater, more: false, state: "watching" };
    const rows = ctx.db.prepare(`SELECT m.id, d.seq, COALESCE(NULLIF(m.from_handle, ''), s.handle) AS sender_handle,
      m.kind, m.priority, m.subject, m.body, m.thread_id, m.created_at, d.state, d.wake
      FROM deliveries d JOIN messages m ON m.id = d.message_id JOIN sessions s ON s.id = m.from_session
      WHERE d.session_id = ? AND d.seq > ? AND d.seq <= ? AND m.priority != 'fyi' AND m.hops <= 3
      AND EXISTS (SELECT 1 FROM message_targets t WHERE t.message_id = m.id AND t.target_type = 'topic' AND t.target_id = ?)
      ORDER BY d.seq LIMIT ?`).all(params.session_id, params.since_seq, highwater, params.topic, params.limit + 1) as unknown as HeaderRow[];
    const headers = rows.slice(0, params.limit).map(row => MessageHeader.parse({
      id: row.id, seq: row.seq, from: row.sender_handle, kind: row.kind, priority: row.priority,
      ...(row.subject === null ? {} : { subject: row.subject }), preview: makePreview(row.body),
      thread_id: row.thread_id, created_at: row.created_at, state: row.state, wake: row.wake === 1,
    }));
    const more = rows.length > params.limit;
    return { headers, cursor: more ? headers.at(-1)!.seq : Math.max(highwater, params.since_seq), more, state: "watching" };
  });
}

/** Read-only bounded scan; its cursor is never a read receipt. */
export function resyncDeliveryPage(ctx: HubContext, peer: HubPeer,
  params: z.output<(typeof Methods)["deliveries.resync.page"]>): z.output<(typeof Results)["deliveries.resync.page"]> {
  return transaction(ctx, () => {
    const session = requireSession(ctx, peer, params.session_id);
    const through = params.through ?? Math.max(params.after,
      (ctx.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM deliveries WHERE session_id = ?")
        .get(session.id) as { seq: number }).seq);
    const rows = ctx.db.prepare(`SELECT message_id, seq, wake FROM deliveries
      WHERE session_id = ? AND state = 'unread' AND seq > ? AND seq <= ? ORDER BY seq LIMIT ?`)
      .all(session.id, params.after, through, RESYNC_PAGE_COUNT + 1) as unknown as Array<{ message_id: string; seq: number; wake: number }>;
    const deliveries: z.output<typeof Notifications.deliver>[] = [];
    let cursor = params.after;
    for (const row of rows) {
      if (deliveries.length === RESYNC_PAGE_COUNT) break;
      const message = getStoredMessage(ctx, row.message_id);
      if (!message) throw new RpcFault(errors.notFound, "message not found");
      const delivery = Notifications.deliver.parse({ message, session_id: session.id, seq: row.seq,
        wake: row.wake === 1 && session.wake === "on" });
      // Account for the larger terminal cursor and boolean spelling before accepting a row.
      const candidate = { session_id: session.id, through, cursor: through, more: false, deliveries: [...deliveries, delivery] };
      if (Buffer.byteLength(JSON.stringify(candidate)) > RESYNC_PAGE_BYTES) {
        if (deliveries.length === 0) throw new RpcFault(-32011, "delivery exceeds resync page limit");
        break;
      }
      deliveries.push(delivery);
      cursor = row.seq;
    }
    const more = deliveries.length < rows.length;
    return { session_id: session.id, through, cursor: more ? cursor : through, more, deliveries };
  });
}
