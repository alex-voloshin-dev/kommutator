import { expect, it, vi } from "vitest";
import { phase, withCleanup, matchesFixtureDaemon } from "./fixture-lifecycle.js";

it("preserves the original body failure and reports cleanup failure separately", async () => {
  const body = new Error("original registration assertion");
  const cleanup = new Error("shutdown timeout");
  const close = vi.fn(async () => { throw cleanup; });
  const failure = await withCleanup(async () => { throw body; }, close).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors).toEqual([body, cleanup]);
  expect(close).toHaveBeenCalledOnce();
});

it("preserves a lone body or cleanup error unchanged", async () => {
  const failure = new Error("original");
  await expect(withCleanup(async () => { throw failure; }, async () => {})).rejects.toBe(failure);
  await expect(withCleanup(async () => {}, async () => { throw failure; })).rejects.toBe(failure);
});

it("bounds a stuck phase and retains its operation label", async () => {
  vi.useFakeTimers();
  try {
    const outcome = phase("cleanup daemon shutdown", async () => new Promise(() => {}), 100).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    const error = await outcome;
    expect(error.message).toBe("Fixture phase: cleanup daemon shutdown");
    expect(error.cause.message).toBe("fixture phase deadline exceeded");
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it("requires the complete daemon command and exact private home before signalling", () => {
  const argv = ["/node", "/fixture/index.js", "daemon", "run", ""].join("\0");
  const matches = (command: string, environment = "KOM_HOME=/private\0") =>
    matchesFixtureDaemon(command, environment, "/node", "/fixture/index.js", "/private");
  expect(matches(argv)).toBe(true);
  expect(matches(argv.replace("/node", "/other"))).toBe(false);
  expect(matches(argv + "extra\0")).toBe(false);
  expect(matches(argv.slice(0, -1))).toBe(false);
  expect(matches(argv, "KOM_HOME=/private-other\0")).toBe(false);
});
