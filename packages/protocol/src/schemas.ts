// zod schemas for the core records and JSON-RPC methods (DESIGN.md §3, §5, §7).
// Only what M1 needs; extend as methods are implemented.

import * as z from "zod";
import { Ident } from "./ident.js";
import { AddressError, parseAddress } from "./address.js";
import { IpcHello, Vendor } from "./hello.js";

export { Vendor } from "./hello.js";
export const SessionState = z.enum(["active", "idle", "gone", "unknown"]);
export const Capability = z.enum(["native", "hook", "none"]);
export const MessageKind = z.enum(["dm", "topic", "broadcast", "request"]);
export const Priority = z.enum(["normal", "fyi"]);
export const Origin = z.enum(["agent", "human"]);
export const ReceiptState = z.enum(["unread", "read"]);

// Limits (characters, i.e. JS string length — not bytes). Enforced on both the
// write methods and the records they produce.
export const LIMITS = {
  statusLine: 200,
  subject: 200,
  body: 64_000,
  boardKey: 120,
  boardBody: 16_384,
  topicName: 120,
  recipients: 20,
  receiptIds: 200,
  listLimit: 200,
  /** Characters of the body's first line shown in a header. */
  preview: 200,
  /** Headers injected per hook invocation. */
  headersPerInjection: 5,
  /** Characters of injected text per hook invocation, trailer included (vendor cap is 10,000). */
  injectionBudget: 4_000,
} as const;

export const TopicName = z.string().min(1).max(LIMITS.topicName)
  .describe("Topic name. New ad-hoc topics use hyphens between words and contain no whitespace; legacy names remain readable.");
export const NewTopicName = TopicName.refine((name) => !/[\s\p{White_Space}]/u.test(name),
  "new topic names cannot contain whitespace; use hyphens between words");
export const BoardKey = z.string().min(1).max(LIMITS.boardKey);
export const BoardBody = z.string().max(LIMITS.boardBody);
export const SessionId = z.string().min(1).max(64);
export const MessageId = z.string().min(1).max(64);

export const Session = z.object({
  id: SessionId.optional(), // assigned by the hub on first upsert
  host: Ident,
  name: Ident,
  role: Ident.optional(),
  vendor: Vendor,
  vendor_session_id: z.string().max(200).optional(),
  cwd: z.string().max(1024).optional(),
  project_key: z.string().max(300).optional(),
  state: SessionState.default("active"),
  status_line: z.string().max(LIMITS.statusLine).optional(),
  incarnation: z.number().int().nonnegative().default(0),
  wake: z.enum(["on", "off"]).default("on"),
  capability: Capability.default("none"),
});
export type Session = z.infer<typeof Session>;

export const Message = z.object({
  id: MessageId.optional(), // assigned by the hub
  from: z.string().max(130), // handle
  to: z.array(z.string().max(300)).min(1).max(LIMITS.recipients), // parsed with parseAddress()
  kind: MessageKind.default("dm"),
  priority: Priority.default("normal"),
  subject: z.string().max(LIMITS.subject).optional(),
  body: z.string().max(LIMITS.body),
  thread_id: MessageId.optional(),
  reply_to: MessageId.nullable().optional(),
  hops: z.number().int().nonnegative().default(0),
  origin: Origin.default("agent"),
  /** Set by `kom send --wake`; honoured only when origin is `human` (DESIGN.md §6). */
  force_wake: z.boolean().default(false),
  created_at: z.string().datetime().optional(),
});
export type Message = z.infer<typeof Message>;

/** Syntax validation for new sends only; historical message records retain their wire shape. */
export const SendAddress = z.string().max(300).superRefine((value, ctx) => {
  if (value.length > 300) return; // Keep the bounded length error; never parse or echo oversized input.
  try { parseAddress(value); }
  catch (error) {
    if (!(error instanceof AddressError)) throw error;
    ctx.addIssue({ code: "custom", message: "bad address; use topic:<name>, <name>@<host>, @role:<role>, or all" });
  }
});
export const OutboundMessage = Message.extend({
  to: z.array(SendAddress).min(1).max(LIMITS.recipients),
});

/** A message as the hub stores and delivers it: id, thread and timestamp are assigned. */
export const StoredMessage = Message.extend({
  id: MessageId,
  thread_id: MessageId,
  created_at: z.string().datetime(),
});
export type StoredMessage = z.infer<typeof StoredMessage>;

export const BoardEntry = z.object({
  topic: TopicName,
  key: BoardKey,
  body: BoardBody,
  version: z.number().int().positive(),
  author: z.string().max(130), // handle of the writing session, derived by the hub
  protected: z.boolean().default(false),
  updated_at: z.string().datetime(),
});
export type BoardEntry = z.infer<typeof BoardEntry>;

// JSON-RPC method params. Keys are the method names on the wire.
// Every session-scoped method carries `session_id`: agentd fills it from the IPC
// connection the call arrived on, and the hub authorizes against that session's
// topic memberships. Clients never choose it.
export const Methods = {
  /** agentd → hub, once per WebSocket. */
  "hello": z.object({
    host: Ident,
    agentd_version: z.string().max(40),
    protocol_version: z.number().int(),
  }),
  /**
   * shim / hook → agentd, once per IPC connection. This is what binds the connection to a
   * local session: the shim reports its own pid (which dies with the agent) and what it
   * learned from MCP `initialize`; a hook reports the vendor's session id and the pid it
   * sees as its parent. agentd never trusts a `session_id` from the client — it resolves
   * one from these facts.
   */
  "ipc.hello": IpcHello,
  /**
   * Three distinct operations, picked by `op` (DESIGN.md §3):
   *   register — first appearance of a session (no hub id yet). `reg_id` is chosen by agentd
   *              before the first send; a replay with the same reg_id returns the same
   *              id/incarnation/handle, never a new suffix.
   *   update   — change status_line / role / name / wake of a known session (`session.id`
   *              required); idempotent, incarnation unchanged.
   *   reincarnate — the same logical session came back (daemon restart, re-registration
   *              after `gone`); `session.id` required, a fresh `reg_id`, and the hub sets
   *              incarnation = current + 1. A replay with the same reg_id returns that
   *              incarnation again.
   */
  "session.upsert": z.discriminatedUnion("op", [
    // `.strict()` so a stray `id` on register is an error, not silently stripped.
    z.object({ op: z.literal("register"), session: Session.omit({ id: true, incarnation: true }).strict(), reg_id: z.string().min(8).max(64) }),
    // update: id required, every other field optional (a status-only update is the common case).
    // capability is daemon-owned: later hook facts can change the effective delivery mode.
    z.object({ op: z.literal("update"), session: Session.pick({ id: true, name: true, role: true, status_line: true, wake: true, capability: true }).partial().extend({ wake: Session.shape.wake.removeDefault().optional(), capability: Capability.optional() }).required({ id: true }).strict() }),
    z.object({ op: z.literal("reincarnate"), session: Session.required({ id: true }), reg_id: z.string().min(8).max(64) }),
  ]),
  /** The hub ignores a `gone` whose incarnation is older than the session's current one. */
  "session.gone": z.object({ session_id: SessionId, incarnation: z.number().int().nonnegative() }),
  "session.heartbeat": z.object({ session_id: SessionId, state: SessionState }),
  "session.list": z.object({
    session_id: SessionId,
    topic: TopicName.optional(),
    role: Ident.optional(),
    state: SessionState.optional(),
  }),
  // Replies to a historical author handle must still resolve to that author session.
  // Topic expansion excludes the sender; explicit self addressing still delivers.
  "message.send": z.object({
    session_id: SessionId,
    message: OutboundMessage,
    /** UUID chosen by agentd; the hub stores it with the message and returns the existing
     *  message on a repeat (DESIGN.md §8). */
    idempotency_key: z.string().min(8).max(64),
  }),
  "watch.poll": z.object({
    session_id: SessionId, topic: TopicName,
    since_seq: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).default(50),
  }).strict(),
  "inbox.list": z.object({
    session_id: SessionId,
    since_seq: z.number().int().nonnegative().default(0),
    unread_only: z.boolean().default(false),
    /** Only deliveries the hub marked `wake: true` under the wake rule — what the Stop-time
     *  poll asks for, so fyi / hops>3 / topic traffic / DND never block a stop (DESIGN §6). */
    waking_only: z.boolean().default(false),
    limit: z.number().int().positive().max(LIMITS.listLimit).default(50),
  }),
  /**
   * agentd → hub after a reconnect: "resend every delivery for my sessions that is still
   * unread and that I have not acknowledged". The hub replays `deliver` notifications for
   * them; agentd de-duplicates on (session_id, seq). This is how a `deliver` lost while the
   * WebSocket was down reaches the recipient (DESIGN §8).
   */
  "deliveries.resync": z.object({
    /** Per session id, the highest seq agentd has already acted on (0 if none). */
    acked: z.record(SessionId, z.number().int().nonnegative()),
  }),
  // Authors may read stored messages without a delivery; only actual deliveries get receipts.
  "message.read": z.object({ session_id: SessionId, id: MessageId }),
  "receipt.mark": z.object({
    session_id: SessionId,
    ids: z.array(MessageId).min(1).max(LIMITS.receiptIds),
    state: ReceiptState,
  }),
  /** Ad-hoc topics only: `project:*` membership is derived from project_key, `global` is implicit. */
  "topic.join": z.object({ session_id: SessionId, name: TopicName.refine((n) => !n.startsWith("project:") && n !== "global", "only ad-hoc topics can be joined") }),
  "topic.leave": z.object({ session_id: SessionId, name: TopicName }),
  "topic.list": z.object({ session_id: SessionId, discover: z.boolean().optional() }),
  // CLI management may explicitly select an existing live local session; the hub still
  // enforces host ownership and topic membership. Shims cannot supply session_id.
  "board.get": z.object({ session_id: SessionId, topic: TopicName, key: BoardKey.optional() }),
  "board.put": z.object({
    session_id: SessionId,
    topic: TopicName,
    key: BoardKey,
    body: BoardBody,
    if_version: z.number().int().positive().optional(),
    protected: z.boolean().optional(),
    /** UUID chosen by agentd. The hub records it on the version it creates; a replay with
     *  the same op_id returns that version instead of a conflict (DESIGN.md §8). */
    op_id: z.string().min(8).max(64),
  }),
  "board.history": z.object({
    session_id: SessionId, topic: TopicName, key: BoardKey,
    /** Newest first; exclusive cursor from the previous page. */
    before_version: z.number().int().positive().optional(),
    // Ten maximally escaped board bodies still fit inside the 1 MiB frame limit.
    limit: z.number().int().min(1).max(10).default(10),
  }),
  "status": z.object({}),
} as const;

export type MethodName = keyof typeof Methods;

// Hub → agentd notifications.
export const Notifications = {
  deliver: z.object({
    message: StoredMessage,
    session_id: SessionId,
    seq: z.number().int().positive(),
    /** The hub's decision for this delivery (wake rule applied); not the session's policy. */
    wake: z.boolean(),
  }),
  config: z.object({
    coalesce_ms: z.number().int().positive().default(30_000),
    hops_max: z.number().int().positive().default(3),
  }),
} as const;

/** Maximum size of one JSON-RPC frame on either hop, in bytes. */
export const MAX_FRAME_BYTES = 1_048_576;

/** Read-only local diagnostics selector; never grants a session binding. */
export const DaemonStatusParams = z.object({
  caller: z.object({
    vendor: z.enum(["claude-code", "codex"]),
    vendor_session_id: z.string().min(1).max(200),
    pid: z.number().int().positive(),
    process_started_at: z.string().min(1).max(200),
    owner_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  }).strict().optional(),
}).strict();
