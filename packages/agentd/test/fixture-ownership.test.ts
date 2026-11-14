import { expect, it } from "vitest";
import { ownedStartup } from "./fixtures/owned-startup.js";

it("waits for pending startup before removing its home and rejects late test continuation", async () => {
  const events: string[] = [];
  const cleanups: Array<() => Promise<void>> = [async () => { events.push("remove home"); }];
  let release!: (resource: { close: () => Promise<void> }) => void;
  const held = new Promise<{ close: () => Promise<void> }>(resolve => { release = resolve; });
  const starting = ownedStartup(() => held, cleanups);
  const rejected = expect(starting).rejects.toThrow("fixture cleanup began before startup completed");
  const cleanup = cleanups.pop()!;
  const closing = cleanup();
  const repeated = cleanup();
  expect(events).toEqual([]);
  release({ close: async () => { events.push("close daemon"); } });
  await Promise.all([closing, repeated]);
  await cleanups.pop()!();
  await rejected;
  expect(events).toEqual(["close daemon", "remove home"]);
});

it("preserves the original startup rejection while still allowing home cleanup", async () => {
  const failure = new Error("original startup failure");
  const events: string[] = [];
  const cleanups: Array<() => Promise<void>> = [async () => { events.push("remove home"); }];
  const starting = ownedStartup(async () => { throw failure; }, cleanups);
  const rejected = expect(starting).rejects.toBe(failure);
  for (const cleanup of cleanups.reverse()) await cleanup();
  await rejected;
  expect(events).toEqual(["remove home"]);
});

it("owns both successful starters even if the single-winner assertion fails", async () => {
  const events: string[] = [];
  const cleanups: Array<() => Promise<void>> = [async () => { events.push("remove home"); }];
  const results = await Promise.allSettled([1, 2].map(id => ownedStartup(async () => ({
    close: async () => { events.push(`close ${id}`); },
  }), cleanups)));
  // Deliberately exercise the assertion-failure path without leaking either resource.
  expect(() => expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1)).toThrow();
  for (const cleanup of cleanups.reverse()) await cleanup();
  expect(events).toEqual(["close 2", "close 1", "remove home"]);
});

it("does not suppress a resource close failure", async () => {
  const failure = new Error("close failure");
  const cleanups: Array<() => Promise<void>> = [];
  await ownedStartup(async () => ({ close: async () => { throw failure; } }), cleanups);
  await expect(cleanups[0]!()).rejects.toBe(failure);
});
