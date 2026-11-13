import { IPC_TRANSPORT_CLOSED } from "./ipc-client.js";
type Management = (method: "daemon.shutdown" | "daemon.status", timeoutMs: number) => Promise<unknown>;
const errorCode = (error: unknown): unknown => error && typeof error === "object" && "code" in error ? error.code : undefined;
const transitioning = (code: unknown) => code === "ECONNRESET" || code === -32031 || code === IPC_TRANSPORT_CLOSED;
const absent = (code: unknown) => code === "ENOENT" || code === "ECONNREFUSED";

/** A reset is uncertain; only a fresh absent-listener probe authorizes replacement. */
export async function confirmDaemonStopped(request: Management, timing = {
  now: () => performance.now(),
  wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
}): Promise<void> {
  const deadline = timing.now() + 2_000;
  try { await request("daemon.shutdown", Math.max(1, deadline - timing.now())); }
  catch (error) {
    const code = errorCode(error);
    if (absent(code)) return;
    if (!transitioning(code)) throw new Error("Daemon shutdown request failed; no replacement started");
  }
  while (timing.now() < deadline) {
    try { await request("daemon.status", Math.max(1, deadline - timing.now())); }
    catch (error) {
      const code = errorCode(error);
      if (absent(code)) return;
      if (!transitioning(code)) throw new Error("Daemon stop confirmation failed; no replacement started");
    }
    const remaining = deadline - timing.now();
    if (remaining > 0) await timing.wait(Math.min(50, remaining));
  }
  throw new Error("Daemon stop was not confirmed within 2 seconds; no replacement started");
}
