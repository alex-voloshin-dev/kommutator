import { describe, expect, it, vi } from "vitest";
import { ClaudeStatusClient } from "../src/claude-status.js";
import type { ActiveClaudeRegistration } from "../src/plugin-context.js";

const registration = (generation = 1): ActiveClaudeRegistration => ({
  birth: "process-birth", generation: `process-birth:${generation}`,
  hello: { client: "hook", protocol_version: 1, runtime_contract: 4, vendor: "claude-code", vendor_session_id: "conversation",
    pid: 456, ppid: 123, owner_generation: generation, cwd: "/project", token: "never-forward-this" },
});
const healthy = { health: { state: "healthy", issues: [] }, hub: { connected: true }, outbox_depth: 0 };

describe("Claude caller diagnostics", () => {
  it("queries only status with exact process identity and no credentials", async () => {
    const response = { ...healthy, caller: { state: "active", session_id: "session" } };
    const call = vi.fn(async () => response);
    const resolve = vi.fn(async () => registration());
    const client = new ClaudeStatusClient({ call, close() {} }, resolve);
    expect(await client.call("daemon.status")).toMatchObject(response);
    expect(call.mock.calls).toEqual([["daemon.status", { caller: {
      vendor: "claude-code", vendor_session_id: "conversation", pid: 123,
      process_started_at: "process-birth", owner_generation: 1,
    } }]]);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(call.mock.calls)).not.toContain("never-forward-this");
  });

  it("preserves gone and conflicting caller diagnoses despite a reachable hub", async () => {
    for (const state of ["gone", "conflicting"]) {
      const response = { ...healthy, health: { state: "degraded", issues: ["Caller registration failed"] },
        caller: { state, reason: "session-end", recovery: "Run /exit, then claude --resume" } };
      const call = vi.fn(async () => response);
      const client = new ClaudeStatusClient({ call, close() {} }, async () => registration());
      expect(await client.call("daemon.status")).toMatchObject(response);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps global diagnostics available when registration is missing without exposing resolver errors", async () => {
    const call = vi.fn(async () => healthy);
    const client = new ClaudeStatusClient({ call, close() {} }, async () => { throw new Error("secret-token"); });
    const result = await client.call("daemon.status");
    expect(result).toMatchObject({ hub: { connected: true }, outbox_depth: 0,
      health: { state: "degraded" }, caller: { state: "unavailable", recovery: expect.stringContaining("claude --resume") } });
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(call.mock.calls).toEqual([["daemon.status", {}]]);
  });

  it("does not send an incomplete owner selector or substitute another identity", async () => {
    const call = vi.fn(async () => healthy);
    const incomplete = registration();
    delete incomplete.hello.ppid;
    const client = new ClaudeStatusClient({ call, close() {} }, async () => incomplete);
    expect(await client.call("daemon.status")).toMatchObject({ caller: { state: "unavailable" } });
    expect(call.mock.calls).toEqual([["daemon.status", {}]]);
  });

  it("does not present a previous conversation's caller result after a generation switch", async () => {
    const response = { ...healthy, caller: { state: "active", session_id: "previous" } };
    const resolve = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(registration(2));
    const client = new ClaudeStatusClient({ call: async () => response, close() {} }, resolve);
    const result = await client.call("daemon.status");
    expect(result).toMatchObject({ health: { state: "degraded" }, caller: { state: "conflicting" } });
    expect(result).toHaveProperty("caller.recovery", expect.stringContaining("Call status again"));
    expect(result).not.toHaveProperty("caller.session_id");
  });

  it("marks an ended hook registration unavailable if it disappears during status", async () => {
    const resolve = vi.fn().mockResolvedValueOnce(registration()).mockRejectedValueOnce(new Error("ended"));
    const client = new ClaudeStatusClient({ call: async () => ({ ...healthy, caller: { state: "active" } }), close() {} }, resolve);
    expect(await client.call("daemon.status")).toMatchObject({ health: { state: "degraded" }, caller: { state: "unavailable" } });
  });

  it("reports an old daemon without caller diagnostics as unverified, not active", async () => {
    const client = new ClaudeStatusClient({ call: async () => healthy, close() {} }, async () => registration());
    expect(await client.call("daemon.status")).toMatchObject({ health: { state: "degraded" }, caller: { state: "unverified" } });
  });

  it("never uses the diagnostic client for mutating or identity calls", async () => {
    const call = vi.fn(async () => healthy), resolve = vi.fn(async () => registration());
    const client = new ClaudeStatusClient({ call, close() {} }, resolve);
    await expect(client.call("whoami")).rejects.toThrow("only supports status");
    await expect(client.call("session.upsert")).rejects.toThrow("only supports status");
    expect(call).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
