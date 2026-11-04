import * as z from "zod";
import { MAX_FRAME_BYTES, Methods, PROTOCOL_VERSION, type MethodName } from "@kommutator/protocol";
import { defaultId, RpcFault, type HubContext, type HubPeer } from "./context.js";
import { HubEvents } from "./events.js";
import { hello, upsertSession, heartbeatSession, goneSession, listSessions } from "./sessions.js";
import { joinTopic, leaveTopic, listTopics } from "./topics.js";
import { getBoard, putBoard, boardHistory } from "./board.js";
import { sendMessage } from "./routing.js";
import { watchTopic, listInbox, readMessage, markReceipt, resyncDeliveries } from "./inbox.js";
import type { DatabaseSync } from "node:sqlite";

const RpcEnvelope = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string().max(128), z.number().int()]).nullable().optional(),
  method: z.string().min(1).max(128),
  params: z.unknown().optional(),
});

export function rpcError(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

export interface HubRuntimeOptions {
  db: DatabaseSync;
  now?: () => string;
  newId?: () => string;
  onError?: (error: unknown) => void;
}

/** The same dispatcher runs behind WebSocket and in the conformance harness. */
export function createHubRuntime(opts: HubRuntimeOptions) {
  const now = opts.now ?? (() => new Date().toISOString());
  const report = opts.onError ?? ((error: unknown) => console.warn("hub RPC error", error));
  const events = new HubEvents(now, report);
  const ctx: HubContext = { db: opts.db, events, now, newId: opts.newId ?? defaultId };

  function params<M extends MethodName>(method: M, input: unknown): z.output<(typeof Methods)[M]> {
    const parsed = Methods[method].safeParse(input ?? {});
    if (!parsed.success) throw new RpcFault(-32602, "invalid params");
    return parsed.data as z.output<(typeof Methods)[M]>;
  }

  function call(peer: HubPeer, method: string, input: unknown): unknown {
    switch (method) {
      case "hello": return hello(ctx, peer, params(method, input));
      case "session.upsert": return upsertSession(ctx, peer, params(method, input));
      case "session.heartbeat": return heartbeatSession(ctx, peer, params(method, input));
      case "session.gone": return goneSession(ctx, peer, params(method, input));
      case "session.list": return listSessions(ctx, peer, params(method, input));
      case "message.send": return sendMessage(ctx, peer, params(method, input));
      case "watch.poll": return watchTopic(ctx, peer, params(method, input));
      case "inbox.list": return listInbox(ctx, peer, params(method, input));
      case "message.read": return readMessage(ctx, peer, params(method, input));
      case "receipt.mark": return markReceipt(ctx, peer, params(method, input));
      case "deliveries.resync": return resyncDeliveries(ctx, peer, params(method, input));
      case "topic.join": return joinTopic(ctx, peer, params(method, input));
      case "topic.leave": return leaveTopic(ctx, peer, params(method, input));
      case "topic.list": return listTopics(ctx, peer, params(method, input));
      case "board.get": return getBoard(ctx, peer, params(method, input));
      case "board.put": return putBoard(ctx, peer, params(method, input));
      case "board.history": return boardHistory(ctx, peer, params(method, input));
      case "status": {
        params(method, input);
        const count = (table: "hosts" | "sessions" | "messages") => {
          const sql = table === "sessions"
            ? "SELECT count(*) AS n FROM sessions WHERE ended_at IS NULL"
            : table === "hosts" ? "SELECT count(*) AS n FROM hosts" : "SELECT count(*) AS n FROM messages";
          return (ctx.db.prepare(sql).get() as { n: number }).n;
        };
        return { protocol_version: PROTOCOL_VERSION, hosts: count("hosts"), sessions: count("sessions"), messages: count("messages") };
      }
      default: throw new RpcFault(-32601, "method not found");
    }
  }

  return {
    events,
    context: ctx,
    dispatch(raw: string, peer: HubPeer): string | undefined {
      return dispatch(raw, (method, input) => call(peer, method, input), report);
    },
  };
}

export type HubRuntime = ReturnType<typeof createHubRuntime>;

/** Validate before field access; execute notifications but never answer them. */
export function dispatch(
  raw: string,
  invoke?: (method: string, input: unknown) => unknown,
  onError: (error: unknown) => void = () => {},
): string | undefined {
  if (Buffer.byteLength(raw, "utf8") > MAX_FRAME_BYTES) return rpcError(null, -32600, "frame too large");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return rpcError(null, -32700, "parse error"); }
  const envelope = RpcEnvelope.safeParse(parsed);
  if (!envelope.success) return rpcError(null, -32600, "invalid request");
  const { id, method, params } = envelope.data;
  const notification = id === undefined || id === null;
  try {
    if (!invoke) throw new RpcFault(-32601, "method not found");
    const result = invoke(method, params);
    if (notification) return undefined;
    const reply = JSON.stringify({ jsonrpc: "2.0", id, result });
    if (Buffer.byteLength(reply, "utf8") > MAX_FRAME_BYTES) {
      return rpcError(id, -32011, "result exceeds frame limit; narrow query or reduce page size");
    }
    return reply;
  } catch (error) {
    if (!(error instanceof RpcFault)) onError(error);
    if (notification) return undefined;
    return rpcError(id, error instanceof RpcFault ? error.code : -32603,
      error instanceof RpcFault ? error.message : "internal error");
  }
}
