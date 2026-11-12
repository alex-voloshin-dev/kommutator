import { expect, it } from "vitest";
import { confirmDaemonStopped } from "../src/daemon-stop.js";

const failure = (code: string | number) => Object.assign(new Error("private transport details"), { code });
function fixture(responses: (string | number | undefined)[]) {
  let now = 0;
  const calls: { method: string; budget: number }[] = [];
  const request = async (method: string, budget: number) => {
    calls.push({ method, budget });
    const response = responses.shift();
    if (response) throw failure(response);
    return { ok: true };
  };
  return { calls, request, timing: { now: () => now, wait: async (ms: number) => { now += ms; } } };
}

it.each(["ENOENT", "ECONNREFUSED"])("accepts an initially absent listener (%s) without another shutdown", async code => {
  const f = fixture([code]);
  await confirmDaemonStopped(f.request, f.timing);
  expect(f.calls.map(c => c.method)).toEqual(["daemon.shutdown"]);
});

it.each([
  ["ECONNRESET", undefined, "ECONNRESET", "ENOENT"],
  [undefined, "ECONNRESET", "ECONNREFUSED"],
  [-32031, -32031, "ENOENT"],
])("confirms absence after reset without replaying shutdown", async (...responses) => {
  const f = fixture(responses);
  await confirmDaemonStopped(f.request, f.timing);
  expect(f.calls.filter(c => c.method === "daemon.shutdown")).toHaveLength(1);
  expect(f.calls.slice(1).every(c => c.method === "daemon.status")).toBe(true);
  expect(f.calls.every(c => c.budget > 0 && c.budget <= 2_000)).toBe(true);
});

it.each([undefined, "ECONNRESET", -32031])("refuses a listener that keeps responding/resetting (%s)", async response => {
  const f = fixture(Array.from({ length: 100 }, () => response));
  await expect(confirmDaemonStopped(f.request, f.timing)).rejects.toThrow("not confirmed within 2 seconds");
  expect(f.calls.filter(c => c.method === "daemon.shutdown")).toHaveLength(1);
});

it.each([["EACCES"], [undefined, "EACCES"], [-32001], [undefined, -32600]])("keeps non-reset failures stage-specific and redacted", async (...responses) => {
  const expected = responses.length === 1 ? "shutdown request failed" : "stop confirmation failed";
  const f = fixture(responses);
  const error = await confirmDaemonStopped(f.request, f.timing).catch((value: unknown) => value);
  if (!(error instanceof Error)) throw new Error("Expected a stop failure");
  expect(error.message).toContain(expected);
  expect(error.message).not.toContain("private transport details");
});

it.each(["Daemon disconnected", "Malformed IPC response"])("does not treat an uncoded %s error as a reset", async message => {
  const calls: string[] = [];
  await expect(confirmDaemonStopped(async method => {
    calls.push(method);
    if (method === "daemon.shutdown") return {};
    throw new Error(message);
  })).rejects.toThrow("Daemon stop confirmation failed; no replacement started");
  expect(calls).toEqual(["daemon.shutdown", "daemon.status"]);
});

it("charges shutdown and confirmation work to the same deadline", async () => {
  let now = 0;
  const budgets: number[] = [];
  await expect(confirmDaemonStopped(async (_method, budget) => {
    budgets.push(budget);
    now += 975;
    return {};
  }, { now: () => now, wait: async ms => { now += ms; } })).rejects.toThrow("not confirmed within 2 seconds");
  expect(budgets).toEqual([2_000, 1_025]);
  expect(now).toBe(2_000);
});
