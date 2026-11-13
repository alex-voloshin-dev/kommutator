import { DaemonRuntimeResult, RELEASE_VERSION, RUNTIME_CONTRACT } from "@kommutator/protocol";
import * as z from "zod";
import { IpcError, IpcClient, cliHello } from "./ipc-client.js";

const expectedRuntimeContract = RUNTIME_CONTRACT;
const Version = z.string().max(64).regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).nullable().catch(null);
const ObservedRuntime = z.object({
  runtime_contract: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().catch(null),
  daemon: z.object({ version: Version }).catch({ version: null }),
});
type DaemonState = "stopped" | "compatible" | "incompatible" | "unavailable";
const recovery: Partial<Record<DaemonState, string>> = {
  incompatible: "Upgrade the affected client's MCP and all lifecycle hook wiring. After ending active sessions in that client, run the installed plugin's bin/manage daemon restart locally, then launch a new client OS process with trusted SessionStart hooks (/exit, then claude --resume for Claude). Reloading plugins in the old process is insufficient. Unrelated old clients may remain unavailable; no host-wide process shutdown is required. No restart was performed; configuration and compatibility do not prove session registration.",
  stopped: "The shared daemon is stopped. Resume your client with trusted SessionStart hooks, then call whoami to register and start the shared daemon. No daemon was started by this check.",
  unavailable: "Shared daemon unavailable; inspect the private local configuration and daemon log. No restart was performed.",
};
function diagnostics(daemon: DaemonState, value?: unknown) {
  const observed = ObservedRuntime.safeParse(value);
  return {
    daemon, client_version: RELEASE_VERSION, expected_runtime_contract: expectedRuntimeContract,
    daemon_version: observed.success ? observed.data.daemon.version : null,
    daemon_runtime_contract: observed.success ? observed.data.runtime_contract : null,
    ...(recovery[daemon] ? { recovery: recovery[daemon] } : {}),
  };
}

export async function pluginDaemonDiagnostics(lazyStart = false, timeoutMs = 500, waitForHubMs = 0) {
  const client = new IpcClient({ hello: cliHello, lazyStart, timeoutMs });
  try {
    const deadline = Date.now() + waitForHubMs;
    for (;;) {
      const value = await client.call("daemon.status");
      if (!(value && typeof value === "object" && "runtime_contract" in value && value.runtime_contract === expectedRuntimeContract)) return diagnostics("incompatible", value);
      const hub = "hub" in value ? value.hub : undefined;
      // IPC becomes available before the restarted daemon finishes its first hub handshake.
      // Probe only status; never replay the caller's operation. Offline sends remain queueable.
      if (Date.now() >= deadline || !(hub && typeof hub === "object" && "connected" in hub && hub.connected === false)) return diagnostics("compatible", value);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return diagnostics(code === "ENOENT" || code === "ECONNREFUSED" ? "stopped" : "unavailable");
  } finally { client.close(); }
}
export async function pluginDaemonStatus(lazyStart = false, timeoutMs = 500, waitForHubMs = 0): Promise<DaemonState> {
  return (await pluginDaemonDiagnostics(lazyStart, timeoutMs, waitForHubMs)).daemon;
}
export async function requirePluginDaemon(): Promise<void> {
  const observed = await pluginDaemonDiagnostics(true, 5000, 1000);
  const state = observed.daemon;
  if (state === "incompatible") throw new IpcError(
    `Incompatible shared daemon runtime contract: expected ${expectedRuntimeContract}, observed ${observed.daemon_runtime_contract ?? "missing"} (daemon ${observed.daemon_version ?? "unknown"}). Upgrade all hooks/MCP and the daemon, then start a new client process with trusted hooks. No restart was performed.`, -32601);
  if (state !== "compatible") throw new Error("Shared daemon unavailable; inspect the private local configuration and daemon log.");
}

/** Pure lookup preparation; never replace this with daemon.status diagnostics. */
export async function requirePluginDaemonForLookup(): Promise<void> {
  const client = new IpcClient({ hello: cliHello, lazyStart: false, timeoutMs: 5000, retries: 0 });
  try {
    const observed = DaemonRuntimeResult.parse(await client.call("daemon.runtime", {}));
    if (observed.runtime_contract !== expectedRuntimeContract) {
      throw new IpcError("Local daemon upgrade required for operation lookup; no fallback or restart was performed", -32601);
    }
  } catch (error) {
    if (error instanceof IpcError && error.code === -32020) {
      throw new IpcError("Local daemon upgrade required for operation lookup; no fallback or restart was performed", -32601);
    }
    throw error;
  } finally { client.close(); }
}
