import * as z from "zod";
import { Methods, OutboundMessage } from "./schemas.js";
import { Results } from "./results.js";

export const OperationId = z.uuid();
export const OperationStatusParams = z.object({ operation_id: OperationId }).strict();
export const OperationSubmit = z.discriminatedUnion("method", [
  z.object({ operation_id: OperationId, method: z.literal("message.send"), params: z.object({
    message: OutboundMessage.pick({ to: true, body: true, subject: true, kind: true, priority: true, reply_to: true }).extend({ origin: z.literal("agent"), force_wake: z.literal(false) }).strict(),
  }).strict() }).strict(),
  z.object({ operation_id: OperationId, method: z.literal("receipt.mark"), params: Methods["receipt.mark"].omit({ session_id: true }).extend({ state: z.literal("read") }).strict() }).strict(),
]);
export const OperationSendResult = z.union([
  Results["message.send"].strict(),
  Results["message.send"].omit({ deliveries: true }).extend({ deliveries_omitted: z.literal(true) }).strict(),
]);
export const OperationError = z.object({ category: z.enum(["hub-rpc", "missing-session", "replay-horizon"]), code: z.number().int().optional() }).strict();
const Known = z.object({ operation_id: OperationId, created_at: z.number(), observed_at: z.number() });
const Method = z.enum(["message.send", "receipt.mark"]);
export const OperationStatus = z.union([
  OperationStatusParams.extend({ outcome: z.literal("unknown") }).strict(),
  Known.extend({ method: Method, outcome: z.literal("queued") }).strict(),
  Known.extend({ method: Method, outcome: z.literal("blocked"), error: OperationError }).strict(),
  Known.extend({ method: z.literal("message.send"), outcome: z.literal("confirmed"), result: OperationSendResult }).strict(),
  Known.extend({ method: z.literal("receipt.mark"), outcome: z.literal("confirmed"), result: Results["receipt.mark"].strict() }).strict(),
]);
export type OperationStatus = z.infer<typeof OperationStatus>;
export const OperationSubmitResult = z.union([
  Results["message.send"].extend({ status: z.literal("sent"), operation_id: OperationId }).strict(),
  Results["message.send"].omit({ deliveries: true }).extend({ status: z.literal("sent"), operation_id: OperationId, deliveries_omitted: z.literal(true) }).strict(),
  Results["receipt.mark"].extend({ operation_id: OperationId }),
  z.object({ status: z.literal("queued"), operation_id: OperationId, outbox_depth: z.number().int().nonnegative(),
    idempotency_key: z.string().optional(), outbox_id: z.number().int().optional() }),
  OperationStatusParams.extend({ outcome: z.literal("unknown") }),
]);

export const DaemonRuntimeParams = z.object({}).strict();
export const DaemonRuntimeResult = z.object({
  runtime_contract: z.number().int().nonnegative(),
  daemon: z.object({ version: z.string().min(1).max(64) }).strict(),
}).strict();
