// Result shapes for the methods whose answers clients depend on (DESIGN.md §7).
import * as z from "zod";
import { MessageHeader } from "./headers.js";
import { BoardEntry, MessageId, ReceiptState, Session, SessionId, StoredMessage, TopicName } from "./schemas.js";
import { Ident } from "./ident.js";

export const RegisteredSession = Session.extend({ id: SessionId, handle: z.string().min(3).max(127) });
const Ok = z.object({ ok: z.literal(true) });

export const Results = {
  "hello": z.object({ host: Ident, protocol_version: z.number().int() }),
  "session.upsert": z.object({ session: RegisteredSession, replayed: z.boolean() }),
  "session.heartbeat": Ok,
  "session.gone": Ok,
  "session.list": z.object({ sessions: z.array(RegisteredSession) }),
  "topic.join": Ok,
  "topic.leave": Ok,
  "topic.list": z.object({ topics: z.array(z.object({ name: TopicName, kind: z.enum(["global", "project", "adhoc"]) })) }),
  "receipt.mark": Ok,
  "deliveries.resync": z.object({ replayed: z.number().int().nonnegative() }),
  "board.get": z.object({ entries: z.array(BoardEntry) }),
  "board.history": z.object({
    entries: z.array(BoardEntry), more: z.boolean(),
    next_before_version: z.number().int().positive().nullable(),
  }),
  "status": z.object({
    protocol_version: z.number().int(), hosts: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(), messages: z.number().int().nonnegative(),
  }),
  "inbox.list": z.object({
    headers: z.array(MessageHeader),
    /** Pass as `since_seq` next time. */
    cursor: z.number().int().nonnegative(),
    more: z.boolean(),
  }),
  "message.read": z.object({ message: StoredMessage, state: ReceiptState }),
  /** Hub's answer to message.send. */
  "message.send": z.object({
    id: MessageId,
    /** Per recipient session id: the delivery state the hub holds right after the send. */
    deliveries: z.record(SessionId, ReceiptState),
    /** True when this idempotency key had been seen before and nothing was created. */
    replayed: z.boolean(),
  }),
  /** What the shim's `send` tool returns to the agent: the hub result once acknowledged, or
   *  the local outbox entry while the hub is unreachable. `queued` is not a failure and must
   *  not be retried by sending again — the entry is delivered when the hub is back. */
  "send.local": z.discriminatedUnion("status", [
    z.object({ status: z.literal("sent"), id: MessageId, deliveries: z.record(SessionId, ReceiptState), replayed: z.boolean() }),
    z.object({ status: z.literal("queued"), idempotency_key: z.string(), outbox_depth: z.number().int().nonnegative() }),
  ]),
  "board.put": z.object({
    entry: BoardEntry,
    /** True when the op_id had already been applied and this is that earlier version. */
    replayed: z.boolean(),
  }),
} as const;
