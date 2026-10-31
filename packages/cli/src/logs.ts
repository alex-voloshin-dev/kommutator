import { open, stat, type FileHandle } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import type { Writable } from "node:stream";
import { pathsFor } from "@kommutator/agentd";

const MAX_LINES = 10_000;
const MAX_RECORD_BYTES = 65_536;
const MAX_READ_BYTES = 4 * 1_048_576;
const READ_CHUNK_BYTES = 65_536;

export interface LogsOptions {
  home?: string;
  follow?: boolean;
  lines?: string | number;
  output?: Writable;
  signal?: AbortSignal;
  pollMs?: number;
}

function lineCount(value: string | number = 100): number {
  if ((typeof value === "string" && !/^\d+$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > MAX_LINES) {
    throw new Error(`logs --lines must be an integer between 0 and ${MAX_LINES}`);
  }
  return Number(value);
}

function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sameFile(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

async function openLog(path: string): Promise<LogReader | undefined> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const identity = await file.stat();
    if (!identity.isFile()) throw new Error("Daemon log must be a regular file");
    return new LogReader(file, identity);
  }
  catch (error) {
    await file?.close();
    if (absent(error)) return undefined;
    throw error;
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function write(output: Writable, bytes: Buffer, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error | null) => {
      signal.removeEventListener("abort", stop);
      if (error) reject(error); else resolve();
    };
    const stop = () => done();
    signal.addEventListener("abort", stop, { once: true });
    // Waiting for each callback bounds queued output even when stdout is a slow pipe.
    output.write(bytes, done);
  });
}

class Records {
  private pending = Buffer.alloc(0);
  private discard = false;

  reset(discard = false): void { this.pending = Buffer.alloc(0); this.discard = discard; }

  async consume(bytes: Buffer, output: Writable, signal: AbortSignal): Promise<void> {
    let start = 0;
    while (start < bytes.length && !signal.aborted) {
      const newline = bytes.indexOf(10, start);
      const end = newline < 0 ? bytes.length : newline + 1;
      if (!this.discard) {
        const part = bytes.subarray(start, end);
        if (this.pending.length + part.length > MAX_RECORD_BYTES) throw new Error(`Daemon log record exceeds ${MAX_RECORD_BYTES} bytes`);
        this.pending = this.pending.length ? Buffer.concat([this.pending, part]) : Buffer.from(part);
        if (newline >= 0) {
          await write(output, this.pending, signal);
          this.pending = Buffer.alloc(0);
        }
      }
      if (newline >= 0) this.discard = false;
      start = end;
    }
  }
}

class LogReader {
  private offset = 0;
  private anchor = Buffer.alloc(0);
  private readonly records = new Records();

  constructor(readonly file: FileHandle, readonly identity: Stats) {}

  private async read(size: number, position: number): Promise<Buffer> {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await this.file.read(buffer, 0, size, position);
    return buffer.subarray(0, bytesRead);
  }

  private remember(bytes: Buffer): void {
    this.anchor = Buffer.from(Buffer.concat([this.anchor, bytes]).subarray(-64));
  }

  async initial(lines: number, output: Writable, signal: AbortSignal): Promise<void> {
    const size = (await this.file.stat()).size;
    const start = Math.max(0, size - MAX_READ_BYTES);
    const bytes = await this.read(size - start, start);
    this.offset = start + bytes.length;
    this.remember(bytes);
    if (lines === 0) {
      this.records.reset(bytes.length > 0 && bytes[bytes.length - 1] !== 10);
      return;
    }
    let first = 0;
    let found = 0;
    for (let index = bytes.length - 1; index >= 0; index--) {
      if (bytes[index] === 10 && ++found > lines) { first = index + 1; break; }
    }
    // A capped snapshot may start inside a record; never print that fragment.
    if (start > 0 && found <= lines) this.records.reset(true);
    await this.records.consume(bytes.subarray(first), output, signal);
  }

  async append(output: Writable, signal: AbortSignal): Promise<boolean> {
    const size = (await this.file.stat()).size;
    const anchor = this.offset >= this.anchor.length ? await this.read(this.anchor.length, this.offset - this.anchor.length) : Buffer.alloc(0);
    if (size < this.offset || !anchor.equals(this.anchor)) {
      this.offset = 0;
      this.anchor = Buffer.alloc(0);
      this.records.reset();
    }
    const end = Math.min(size, this.offset + MAX_READ_BYTES);
    while (this.offset < end && !signal.aborted) {
      const bytes = await this.read(Math.min(READ_CHUNK_BYTES, end - this.offset), this.offset);
      if (!bytes.length) break;
      this.offset += bytes.length;
      this.remember(bytes);
      await this.records.consume(bytes, output, signal);
    }
    return this.offset >= size;
  }
}

/** Print complete JSONL records; an absent or empty log has no output. Never starts agentd. */
export async function runLogs(options: LogsOptions = {}): Promise<void> {
  const lines = lineCount(options.lines);
  const pollMs = options.pollMs ?? 250;
  if (!Number.isFinite(pollMs) || pollMs < 1) throw new Error("Log polling interval must be positive");
  const path = pathsFor(options.home).log;
  const output = options.output ?? process.stdout;
  const controller = new AbortController();
  const stop = () => controller.abort();
  let interrupted = false;
  const interrupt = () => { interrupted = true; stop(); };
  let outputError: Error | undefined;
  const onError = (error: Error) => { outputError = error; stop(); };
  let reader: LogReader | undefined;
  const signal = controller.signal;
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  output.on("error", onError);
  if (options.follow) { process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt); }
  try {
    if (signal.aborted) return;
    reader = await openLog(path);
    if (reader) await reader.initial(lines, output, signal);
    if (!options.follow) return;
    while (!signal.aborted) {
      await delay(pollMs, signal);
      if (signal.aborted) break;
      if (reader && !await reader.append(output, signal)) continue;
      let current: Stats | undefined;
      try { current = await stat(path); }
      catch (error) { if (!absent(error)) throw error; }
      if (reader && current && sameFile(reader.identity, current)) continue;
      if (!current) continue;
      const next = await openLog(path);
      if (!next) continue;
      try {
        if (reader && sameFile(reader.identity, next.identity)) continue;
        // Drain the old inode once more before switching to the replacement file.
        if (reader && !await reader.append(output, signal)) continue;
        await reader?.file.close();
        reader = next;
      } finally {
        if (reader !== next) await next.file.close();
      }
      await reader.append(output, signal);
    }
    if (outputError) throw outputError;
  } finally {
    await reader?.file.close();
    options.signal?.removeEventListener("abort", stop);
    output.off("error", onError);
    if (options.follow) { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
    // Node does not destroy stdout; an undrained pipe otherwise prevents signal exit.
    if (interrupted && output === process.stdout && output.writableLength > 0) process.exit(0);
  }
}
