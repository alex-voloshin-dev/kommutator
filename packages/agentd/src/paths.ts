import { homedir, platform, userInfo } from "node:os";
import { join } from "node:path";

/** Well-known on-disk locations (DESIGN.md §8, §13). */
export function pathsFor(home = process.env["KOM_HOME"] ?? join(homedir(), ".kommutator")) {
  return {
  home,
  config: join(home, "config.json"),
  daemonInfo: join(home, "agentd.json"),
  stateDb: join(home, "state.db"),
  log: join(home, "agentd.log"),
  /** Local IPC endpoint: unix socket now, named pipe on Windows (M4). Both work with node:net. */
  ipc: platform() === "win32" ? `\\\\.\\pipe\\kommutator-${userInfo().username}` : join(home, "agentd.sock"),
  } as const;
}

export const paths = pathsFor();
