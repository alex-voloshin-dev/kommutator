import { afterEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Writable } from "node:stream";
import { runLogs } from "../src/logs.js";

const dirs: string[] = [];
const running: { controller: AbortController; done: Promise<void> }[] = [];
afterEach(async () => {
  for (const follower of running.splice(0)) { follower.controller.abort(); await follower.done; }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const home = await mkdtemp(join(tmpdir(), "kom-logs-")); dirs.push(home);
  const path = join(home, "agentd.log");
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { home, path, output, text: () => Buffer.concat(chunks).toString("utf8") };
}

function follow(home: string, output: Writable, lines: string | number = 100) {
  const controller = new AbortController();
  const done = runLogs({ home, output, follow: true, lines, signal: controller.signal, pollMs: 5 });
  const follower = { controller, done };
  running.push(follower);
  return follower;
}

const record = (message: string) => JSON.stringify({ at: "2026-10-25T12:00:00.000Z", message }) + "\n";

describe("daemon log tail", () => {
  it("prints only the requested final complete JSONL records and omits a partial final record", async () => {
    const log = await setup();
    await writeFile(log.path, record("one") + record("two") + record("three") + '{"message":"partial');
    await runLogs({ home: log.home, output: log.output, lines: "2" });
    expect(log.text()).toBe(record("two") + record("three"));
  });

  it("defaults to the last 100 records and permits a zero-line snapshot", async () => {
    const log = await setup();
    const lines = Array.from({ length: 120 }, (_, index) => record(String(index)));
    await writeFile(log.path, lines.join(""));
    await runLogs({ home: log.home, output: log.output });
    expect(log.text()).toBe(lines.slice(-100).join(""));
    await runLogs({ home: log.home, output: log.output, lines: 0 });
    expect(log.text()).toBe(lines.slice(-100).join(""));
  });

  it.each(["-1", "1.5", "", "foo", "1e2", "10001", -1, Infinity, NaN])("rejects an invalid count %s before reading", async (lines) => {
    const log = await setup();
    await expect(runLogs({ home: log.home, output: log.output, lines })).rejects.toThrow("--lines");
    expect(log.text()).toBe("");
  });

  it("has no output or side effects when the daemon has never logged", async () => {
    const log = await setup();
    await runLogs({ home: log.home, output: log.output });
    expect(log.text()).toBe("");
    expect(await readdir(log.home)).toEqual([]);
  });

  it("does not follow a log symlink into configuration or another file", async () => {
    const log = await setup();
    const config = join(log.home, "config.json");
    await writeFile(config, JSON.stringify({ key: "synthetic-private-value" }) + "\n");
    await symlink(config, log.path);
    await expect(runLogs({ home: log.home, output: log.output })).rejects.toThrow();
    expect(log.text()).toBe("");
  });

  it("bounds the initial read and does not emit a fragment at its byte limit", async () => {
    const log = await setup();
    await writeFile(log.path, "x".repeat(5 * 1_048_576) + "\n" + record("last"));
    await runLogs({ home: log.home, output: log.output, lines: 10_000 });
    expect(log.text()).toBe(record("last"));
  });

  it("rejects an oversized selected record instead of buffering it indefinitely", async () => {
    const log = await setup();
    await writeFile(log.path, "x".repeat(65_537));
    await expect(runLogs({ home: log.home, output: log.output })).rejects.toThrow("record exceeds");
    expect(log.text()).toBe("");
  });

  it("follows a log created after startup without starting a daemon", async () => {
    const log = await setup();
    follow(log.home, log.output);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await readdir(log.home)).toEqual([]);
    await writeFile(log.path, record("created"));
    await expect.poll(log.text).toBe(record("created"));
    expect(await readdir(log.home)).toEqual(["agentd.log"]);
  });

  it("follows complete records without duplication and preserves split UTF-8 writes", async () => {
    const log = await setup();
    const next = Buffer.from(record("Привет 🌍"));
    const split = next.indexOf(Buffer.from("🌍")) + 2;
    await writeFile(log.path, Buffer.concat([Buffer.from(record("first")), next.subarray(0, split)]));
    follow(log.home, log.output);
    await expect.poll(log.text).toBe(record("first"));
    await appendFile(log.path, next.subarray(split, next.length - 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log.text()).toBe(record("first"));
    await appendFile(log.path, "\n" + record("third"));
    await expect.poll(log.text).toBe(record("first") + next.toString("utf8") + record("third"));
  });

  it("with --lines 0 discards an existing partial record before following new records", async () => {
    const log = await setup();
    await writeFile(log.path, record("old") + '{"message":"partial');
    follow(log.home, log.output, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await appendFile(log.path, '"}\n' + record("new"));
    await expect.poll(log.text).toBe(record("new"));
  });

  it("drains the rotated inode during a missing-path gap then follows its replacement", async () => {
    const log = await setup();
    await writeFile(log.path, record("first"));
    follow(log.home, log.output);
    await expect.poll(log.text).toBe(record("first"));
    await rename(log.path, `${log.path}.1`);
    await appendFile(`${log.path}.1`, record("rotated"));
    await expect.poll(log.text).toBe(record("first") + record("rotated"));
    await writeFile(log.path, record("replacement"));
    await expect.poll(log.text).toBe(record("first") + record("rotated") + record("replacement"));
    await appendFile(log.path, record("appended"));
    await expect.poll(log.text).toBe(record("first") + record("rotated") + record("replacement") + record("appended"));
  });

  it("discards an old inode's incomplete record on rotation", async () => {
    const log = await setup();
    await writeFile(log.path, record("first") + "partial");
    follow(log.home, log.output);
    await expect.poll(log.text).toBe(record("first"));
    await rename(log.path, `${log.path}.1`);
    await writeFile(log.path, record("replacement"));
    await expect.poll(log.text).toBe(record("first") + record("replacement"));
  });

  it.each(["short", "a replacement longer than the original content so size alone cannot detect truncation"])("follows truncation to %s without joining partial records", async (message) => {
    const log = await setup();
    await writeFile(log.path, record("first") + "partial");
    follow(log.home, log.output);
    await expect.poll(log.text).toBe(record("first"));
    await writeFile(log.path, record(message));
    await expect.poll(log.text).toBe(record("first") + record(message));
  });

  it("waits for stdout backpressure before queuing the next record", async () => {
    const log = await setup();
    await writeFile(log.path, record("first") + record("second"));
    const writes: string[] = [];
    const callbacks: (() => void)[] = [];
    const output = new Writable({ highWaterMark: 1, write(chunk: Buffer, _encoding, callback) { writes.push(chunk.toString()); callbacks.push(callback); } });
    const done = runLogs({ home: log.home, output });
    await expect.poll(() => writes.length).toBe(1);
    callbacks.shift()?.();
    await expect.poll(() => writes.length).toBe(2);
    callbacks.shift()?.();
    await done;
    expect(writes.join("")).toBe(record("first") + record("second"));
  });

  it("reports output errors and releases its listeners", async () => {
    const log = await setup();
    await writeFile(log.path, record("first"));
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("output unavailable")); } });
    await expect(runLogs({ home: log.home, output })).rejects.toThrow("output unavailable");
    expect(output.listenerCount("error")).toBe(0);
  });

  it("can stop while stdout is blocked", async () => {
    const log = await setup();
    await writeFile(log.path, record("first") + record("second"));
    let writes = 0;
    const output = new Writable({ highWaterMark: 1, write() { writes++; } });
    const follower = follow(log.home, output);
    await expect.poll(() => writes).toBe(1);
    follower.controller.abort();
    await follower.done;
    expect(writes).toBe(1);
    output.destroy();
  });

  it.each(["SIGINT", "SIGTERM"] as const)("stops cleanly on %s and removes its signal listeners", async (signal) => {
    const log = await setup();
    await writeFile(log.path, record("first"));
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    const follower = follow(log.home, log.output);
    await expect.poll(log.text).toBe(record("first"));
    process.emit(signal);
    await follower.done;
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });
});
