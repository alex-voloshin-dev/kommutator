import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const linuxBirth = /^linux-v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]+$/;
const portableBirth = /^ps-utc-v1:[A-Za-z]{3} [A-Za-z]{3} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

/** The comm field may contain spaces and closing parentheses; ticks are not JS numbers. */
export function linuxProcessBirth(stat: string, boot: string): string | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(boot)) return;
  if (!/^\d+ \(/.test(stat)) return;
  const end = stat.lastIndexOf(")");
  if (end < 0) return;
  const ticks = stat.slice(end + 1).trim().split(/\s+/)[19];
  if (!ticks || !/^[0-9]+$/.test(ticks)) return;
  return `linux-v1:${boot}:${ticks}`;
}

export function processStartSync(pid: number): string | undefined {
  if (process.platform !== "linux" || !Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    return linuxProcessBirth(readFileSync(`/proc/${pid}/stat`, "utf8"), readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
  } catch { return undefined; }
}

/** No alternate-format fallback on Linux failure: unavailable evidence is not a new birth. */
export async function processStart(pid: number): Promise<string | undefined> {
  if (process.platform === "linux") return processStartSync(pid);
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform === "win32") return;
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], {
      timeout: 1000, maxBuffer: 1024, env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
    });
    const birth = `ps-utc-v1:${stdout.trim()}`;
    return portableBirth.test(birth) ? birth : undefined;
  } catch { return undefined; }
}

export function compareProcessBirth(a: string | undefined, b: string | undefined): "same" | "different" | "unverified" {
  if (!a || !b) return "unverified";
  if (a === b) return "same";
  if ((linuxBirth.test(a) && linuxBirth.test(b)) || (portableBirth.test(a) && portableBirth.test(b))) return "different";
  return "unverified";
}

/** Only ESRCH proves exit; permission errors and failed probes are inconclusive. */
export function processExists(pid: number): boolean | undefined {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    return error && typeof error === "object" && "code" in error && error.code === "ESRCH" ? false : undefined;
  }
}
