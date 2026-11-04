import { describe, expect, it, vi } from "vitest";
import { CodexStatusClient } from "../src/codex-status.js";
const healthy = { health: { state: "healthy", issues: [] }, hub: { connected: true } };
describe("read-only Codex caller status", () => {
  it("uses per-call root and exact shim, with no registration calls", async () => {
    const call = vi.fn(async () => ({ ...healthy, caller: { state: "active" } }));
    for (const root of ["one", "two"]) {
      const client = new CodexStatusClient({ call, close() {} }, root, 42, async () => "birth");
      expect(await client.call("daemon.status")).toMatchObject({ caller: { state: "active" } });
    }
    expect(call.mock.calls).toEqual(["one", "two"].map(vendor_session_id => ["daemon.status", { caller: {
      vendor: "codex", vendor_session_id, pid: 42, process_started_at: "birth",
    } }]));
  });
  it("reports unavailable birth and legacy global-only status as unverified", async () => {
    for (const birth of [undefined, "birth"]) {
      const call = vi.fn(async () => healthy);
      const client = new CodexStatusClient({ call, close() {} }, "one", 42, async () => birth);
      expect(await client.call("daemon.status")).toMatchObject({ health: { state: "degraded" }, caller: { state: "unverified" } });
      if (!birth) expect(call.mock.calls).toEqual([["daemon.status", {}]]);
      await expect(client.call("whoami")).rejects.toThrow("only supports status");
      expect(call).toHaveBeenCalledTimes(1);
    }
  });
});
it("falls back read-only when a legacy daemon rejects the Codex selector", async () => {
  const calls: unknown[] = [];
  const client = new CodexStatusClient({ close() {}, async call(method, params) {
    calls.push([method, params]);
    if (params?.caller) throw Object.assign(new Error("invalid parameters"), { code: -32602 });
    return healthy;
  } }, "root", 42, async () => "birth");
  expect(await client.call("daemon.status")).toMatchObject({ caller: { state: "unverified" }, health: { state: "degraded" } });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(["daemon.status", {}]);
});
