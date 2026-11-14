import { expect, it } from "vitest";
import { OperationError, OperationSubmitResult } from "../src/operations.js";

it("accepts additive blocked diagnostics and retains legacy category-only errors", () => {
  expect(OperationError.parse({ category: "hub-rpc", code: -32001 })).toEqual({ category: "hub-rpc", code: -32001 });
  expect(OperationSubmitResult.safeParse({ operation_id: "05160c0e-a715-4a65-a3b4-5995d960b905", method: "message.send",
    outcome: "blocked", created_at: 1, observed_at: 2,
    error: { category: "hub-rpc", code: -32001, reason: "topic-membership-required" } }).success).toBe(true);
});

it("rejects arbitrary reason text and reason attribution to non-RPC errors", () => {
  expect(OperationError.safeParse({ category: "hub-rpc", reason: "private-server-detail" }).success).toBe(false);
  expect(OperationError.safeParse({ category: "missing-session", reason: "topic-membership-required" }).success).toBe(false);
  expect(OperationError.safeParse({ category: "hub-rpc", message: "private-server-detail" }).success).toBe(false);
});
