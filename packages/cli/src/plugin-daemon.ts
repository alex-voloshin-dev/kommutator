import { IpcClient, cliHello } from "./ipc-client.js";

export async function pluginDaemonStatus(lazyStart = false, timeoutMs = 500, waitForHubMs = 0): Promise<"stopped" | "compatible" | "incompatible" | "unavailable"> {
  const client = new IpcClient({ hello: cliHello, lazyStart, timeoutMs });
  try {
    const deadline = Date.now() + waitForHubMs;
    for (;;) {
      const value = await client.call("daemon.status");
      if (!(value && typeof value === "object" && "runtime_contract" in value && value.runtime_contract === 2)) return "incompatible";
      const hub = "hub" in value ? value.hub : undefined;
      // IPC becomes available before the restarted daemon finishes its first hub handshake.
      // Probe only status; never replay the caller's operation. Offline sends remain queueable.
      if (Date.now() >= deadline || !(hub && typeof hub === "object" && "connected" in hub && hub.connected === false)) return "compatible";
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ECONNREFUSED" ? "stopped" : "unavailable";
  } finally { client.close(); }
}
export async function requirePluginDaemon(): Promise<void> {
  const state = await pluginDaemonStatus(true, 5000, 1000);
  if (state !== "compatible") throw new Error(state === "incompatible"
    ? "The running shared daemon predates this plugin runtime contract. After ending active sessions, use the installed plugin's bin/manage daemon restart command locally. No restart was performed."
    : "Shared daemon unavailable; inspect the private local configuration and daemon log.");
}
