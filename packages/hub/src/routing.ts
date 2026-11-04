import {
  AddressError,
  formatAddress,
  parseAddress,
  Results,
  StoredMessage,
  type Address,
  type Message,
  type Methods,
  type Session,
} from "@kommutator/protocol";
import type { z } from "zod";
import {
  errors,
  rejectRetiredOperation,
  requireMembership,
  requireSession,
  RpcFault,
  transaction,
  type HubContext,
  type HubPeer,
  type SessionRow,
} from "./context.js";

interface MessageRow {
  id: string;
  idempotency_key: string;
  from_session: string;
  from_handle: string;
  kind: Message["kind"];
  priority: Message["priority"];
  subject: string | null;
  body: string;
  thread_id: string;
  reply_to: string | null;
  hops: number;
  origin: Message["origin"];
  force_wake: number;
  created_at: string;
}

interface TargetRow { target_type: Address["kind"]; target_id: string }
interface DeliveryRow { session_id: string; state: "unread" | "read" }

/** Topic traffic never wakes; a human override still respects the recipient's DND. */
export function shouldWake(
  session: Pick<Session, "wake">,
  message: Pick<Message, "kind" | "priority" | "hops" | "origin" | "force_wake">,
): boolean {
  if (session.wake === "off" || (message.kind !== "dm" && message.kind !== "request")) return false;
  return (message.origin === "human" && message.force_wake)
    || (message.priority !== "fyi" && message.hops <= 3);
}

function targetsFor(ctx: HubContext, id: string): string[] {
  const rows = ctx.db.prepare("SELECT target_type, target_id FROM message_targets WHERE message_id = ?")
    .all(id) as unknown as TargetRow[];
  return rows.map((target) => {
    switch (target.target_type) {
      case "all": return "all";
      case "role": return `@role:${target.target_id}`;
      case "topic": return `topic:${target.target_id}`;
      case "session": return target.target_id;
    }
  }).sort();
}

export function getStoredMessage(ctx: HubContext, id: string): StoredMessage | undefined {
  const row = ctx.db.prepare(`SELECT m.*, s.handle AS sender_handle FROM messages m
    JOIN sessions s ON s.id = m.from_session WHERE m.id = ?`).get(id) as (MessageRow & { sender_handle: string }) | undefined;
  if (!row) return undefined;
  return StoredMessage.parse({
    id: row.id,
    from: row.from_handle || row.sender_handle,
    to: targetsFor(ctx, id),
    kind: row.kind,
    priority: row.priority,
    ...(row.subject === null ? {} : { subject: row.subject }),
    body: row.body,
    thread_id: row.thread_id,
    reply_to: row.reply_to,
    hops: row.hops,
    origin: row.origin,
    force_wake: row.force_wake === 1,
    created_at: row.created_at,
  });
}

function parseTargets(message: Message): Address[] {
  try {
    const canonical = [...new Set(message.to.map((raw) => formatAddress(parseAddress(raw))))].sort();
    return canonical.map(parseAddress);
  } catch (error) {
    if (error instanceof AddressError) throw new RpcFault(errors.invalidParams, error.message);
    throw error;
  }
}

function resolveRecipients(ctx: HubContext, sender: SessionRow, targets: Address[]): SessionRow[] {
  const recipients = new Map<string, SessionRow>();
  const visible = `SELECT s.* FROM sessions s WHERE s.ended_at IS NULL AND s.state != 'gone'
    AND EXISTS (SELECT 1 FROM memberships theirs JOIN memberships ours ON ours.topic_id = theirs.topic_id
      WHERE theirs.session_id = s.id AND ours.session_id = ?)`;
  for (const target of targets) {
    let rows: SessionRow[];
    switch (target.kind) {
      case "session":
        rows = ctx.db.prepare(`${visible} AND s.handle = ?`).all(sender.id, formatAddress(target)) as unknown as SessionRow[];
        if (rows.length === 0) throw new RpcFault(errors.notFound, "unknown recipient handle");
        break;
      case "role":
        rows = ctx.db.prepare(`${visible} AND s.role = ?`).all(sender.id, target.role) as unknown as SessionRow[];
        break;
      case "topic": {
        const topicId = requireMembership(ctx, sender.id, target.topic);
        // A subscription survives absence; authorization is captured at send time.
        rows = ctx.db.prepare(`SELECT s.* FROM sessions s JOIN memberships m ON m.session_id = s.id WHERE m.topic_id = ?`)
          .all(topicId) as unknown as SessionRow[];
        break;
      }
      case "all":
        rows = ctx.db.prepare(visible).all(sender.id) as unknown as SessionRow[];
        break;
    }
    for (const row of rows) recipients.set(row.id, row);
  }
  return [...recipients.values()];
}

function deliveryStates(ctx: HubContext, id: string): Record<string, "unread" | "read"> {
  const rows = ctx.db.prepare("SELECT session_id, state FROM deliveries WHERE message_id = ?")
    .all(id) as unknown as DeliveryRow[];
  return Object.fromEntries(rows.map((row) => [row.session_id, row.state]));
}

function matchesReplay(ctx: HubContext, row: MessageRow, message: Message, targets: Address[]): boolean {
  return row.kind === message.kind
    && row.priority === message.priority
    && row.subject === (message.subject ?? null)
    && row.body === message.body
    && row.reply_to === (message.reply_to ?? null)
    && row.origin === message.origin
    && (row.force_wake === 1) === message.force_wake
    && JSON.stringify(targetsFor(ctx, row.id)) === JSON.stringify(targets.map(formatAddress));
}

export function sendMessage(
  ctx: HubContext,
  peer: HubPeer,
  params: z.output<(typeof Methods)["message.send"]>,
): z.output<(typeof Results)["message.send"]> {
  const targets = parseTargets(params.message);
  const committed = transaction(ctx, () => {
    const sender = requireSession(ctx, peer, params.session_id);
    rejectRetiredOperation(ctx, "message", params.idempotency_key);
    const previous = ctx.db.prepare("SELECT * FROM messages WHERE idempotency_key = ?")
      .get(params.idempotency_key) as MessageRow | undefined;
    if (previous) {
      if (previous.from_session !== sender.id || !matchesReplay(ctx, previous, params.message, targets)) {
        throw new RpcFault(errors.conflict, "idempotency key already used for a different message");
      }
      return { result: Results["message.send"].parse({ id: previous.id, deliveries: deliveryStates(ctx, previous.id), replayed: true }) };
    }

    let parent: MessageRow | undefined;
    if (params.message.reply_to) {
      parent = ctx.db.prepare(`SELECT m.* FROM messages m WHERE m.id = ? AND
        (m.from_session = ? OR EXISTS (SELECT 1 FROM deliveries d WHERE d.message_id = m.id AND d.session_id = ?))`)
        .get(params.message.reply_to, sender.id, sender.id) as MessageRow | undefined;
      if (!parent) throw new RpcFault(errors.notFound, "reply parent is not accessible");
    }
    const recipients = resolveRecipients(ctx, sender, targets);
    const id = ctx.newId();
    const message = StoredMessage.parse({
      ...params.message,
      id,
      from: sender.handle,
      to: targets.map(formatAddress),
      thread_id: parent?.thread_id ?? id,
      reply_to: parent?.id ?? null,
      hops: parent ? parent.hops + 1 : 0,
      created_at: ctx.now(),
    });
    ctx.db.prepare(`INSERT INTO messages
      (id, idempotency_key, from_session, from_handle, kind, priority, subject, body, thread_id, reply_to, hops, origin, force_wake, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      message.id, params.idempotency_key, sender.id, sender.handle, message.kind, message.priority,
      message.subject ?? null, message.body, message.thread_id, message.reply_to ?? null,
      message.hops, message.origin, Number(message.force_wake), message.created_at,
    );
    const insertTarget = ctx.db.prepare("INSERT INTO message_targets(message_id, target_type, target_id) VALUES (?, ?, ?)");
    for (const target of targets) {
      const targetId = target.kind === "session" ? formatAddress(target)
        : target.kind === "topic" ? target.topic : target.kind === "role" ? target.role : "all";
      insertTarget.run(message.id, target.kind, targetId);
    }
    const insertDelivery = ctx.db.prepare("INSERT INTO deliveries(message_id, session_id, seq, wake, updated_at) VALUES (?, ?, ?, ?, ?)");
    const nextSequence = ctx.db.prepare("UPDATE sessions SET next_seq = next_seq + 1 WHERE id = ?");
    for (const recipient of recipients) {
      insertDelivery.run(message.id, recipient.id, recipient.next_seq, Number(shouldWake(recipient, message)), message.created_at);
      nextSequence.run(recipient.id);
    }
    return {
      result: Results["message.send"].parse({ id: message.id, deliveries: deliveryStates(ctx, message.id), replayed: false }),
      message,
      recipients,
    };
  });

  if (committed.message && committed.recipients) {
    ctx.events.publish("message.sent", { message: committed.message, deliveries: committed.result.deliveries });
    for (const recipient of committed.recipients) {
      const wake = shouldWake(recipient, committed.message);
      ctx.events.publish("delivery.created", {
        message_id: committed.message.id, session_id: recipient.id, seq: recipient.next_seq, wake,
      });
      if (recipient.ended_at !== null || recipient.state === "gone") continue;
      ctx.events.publish("deliver", {
        host: recipient.host,
        notification: {
          message: committed.message,
          session_id: recipient.id,
          seq: recipient.next_seq,
          wake,
        },
      });
    }
  }
  return committed.result;
}
