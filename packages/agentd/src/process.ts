import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Process birth time closes the PID-reuse hole in the adapter's existence probe. */
export async function processStart(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 1000, maxBuffer: 1024 });
    return stdout.trim() || undefined;
  } catch { return undefined; }
}

/** Only ESRCH proves exit; permission errors and failed probes are inconclusive. */
export function processExists(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return error && typeof error === "object" && "code" in error && error.code === "ESRCH" ? false : undefined;
  }
}
