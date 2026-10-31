import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";

const execFileAsync = promisify(execFile);

/** Keep credentials out of project identifiers, including HTTPS userinfo and queries. */
export function normalizeRemote(remote: string): string | undefined {
  const scp = /^(?:[^@/]+@)?([^/:]+):([^/].*)$/.exec(remote.trim());
  let host: string;
  let path: string;
  if (scp && !remote.includes("://")) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const url = new URL(remote);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return undefined;
      host = url.hostname;
      path = url.pathname;
    } catch { return undefined; }
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  const key = `${host.toLowerCase()}/${path}`;
  return host && path && key.length <= 300 ? key : undefined;
}

export class Projects {
  private readonly remotes = new Map<string, Promise<string | undefined>>();
  constructor(private readonly readRemote = async (cwd: string): Promise<string | undefined> => {
    try {
      const { stdout } = await execFileAsync("git", ["-C", cwd, "config", "--get", "remote.origin.url"], { timeout: 50, maxBuffer: 4096 });
      return normalizeRemote(stdout.trim());
    } catch { return undefined; }
  }) {}
  async key(cwd: string, callerProject?: string): Promise<string> {
    let remote = this.remotes.get(cwd);
    if (!remote) { remote = this.readRemote(cwd); this.remotes.set(cwd, remote); }
    return (await remote) ?? callerProject ?? basename(cwd);
  }
}
