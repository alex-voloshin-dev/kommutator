import { ZodError } from "zod";
import { Methods, Results } from "@kommutator/protocol";
import { setTimeout as delay } from "node:timers/promises";
import { IpcClient, cliHello, type RpcClient } from "./ipc-client.js";

export interface WatchOptions { session: string; topic: string; sinceSeq?: number; signal?: AbortSignal }
export interface WatchIO { write: (line: string) => Promise<void>; diagnostic: (state: string) => void; pause: () => Promise<void> }

/** Polling consumes no model turns. Only explicit output becomes a vendor monitor event. */
export async function watch(options: WatchOptions, client: RpcClient, io: WatchIO): Promise<void> {
  let cursor = options.sinceSeq;
  let previous: string | undefined;
  const state = (value: string) => { if (value !== previous) { io.diagnostic(value); previous = value; } };
  const input = Methods["watch.poll"].parse({ session_id: options.session, topic: options.topic,
    ...(cursor === undefined ? {} : { since_seq: cursor }) });
  while (!options.signal?.aborted) {
    let result;
    try {
      result = Results["watch.poll"].parse(await client.call("watch.poll", {
        ...input, ...(cursor === undefined ? {} : { since_seq: cursor }),
      }));
    } catch (error) {
      if (error instanceof ZodError) throw new Error("Invalid watch response; update compatible hub and daemon versions.");
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === -32601 || code === -32602) throw new Error("Watch is unsupported; update both hub and local daemon.");
      if (code === -32001 || code === -32020) throw new Error("Watch authorization lost; verify the exact local session and its topic membership.");
      if (![undefined, -32030, -32031, "ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(code as never)) {
        throw new Error("Watch failed; inspect local diagnostics.");
      }
      state("unavailable; retrying read-only watch");
      await io.pause();
      continue;
    }
    state(result.state);
    for (const header of result.headers) {
      if (options.signal?.aborted) return;
      await io.write(JSON.stringify({ type: "message", trust: "untrusted-peer-content", session_id: input.session_id,
        topic: input.topic, header }) + "\n");
      cursor = header.seq;
    }
    if (result.state === "watching") cursor = result.cursor;
    if (!result.more) await io.pause();
  }
}

export async function runWatch(options: WatchOptions): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const client = new IpcClient({ hello: cliHello, lazyStart: false, retries: 0, timeoutMs: 5000 });
  try {
    await watch({ ...options, signal: controller.signal }, client, {
      write: line => new Promise((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve())),
      diagnostic: state => process.stderr.write(`kom watch: ${state}\n`),
      pause: async () => { try { await delay(2000, undefined, { signal: controller.signal }); } catch { /* Stop requested. */ } },
    });
  } finally { client.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
