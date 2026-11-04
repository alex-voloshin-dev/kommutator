import { readHookObservations } from "./hook-observations.js";
import { processStart } from "@kommutator/agentd";
import type { RpcClient } from "./ipc-client.js";
import * as z from "zod";

const Status = z.object({
  health: z.object({ state: z.enum(["healthy", "degraded"]), issues: z.array(z.string()) }).passthrough().default({ state: "degraded", issues: ["Legacy daemon did not report health."] }),
  caller: z.object({ state: z.string() }).passthrough().optional(),
}).passthrough();

/** Metadata supplies the root; this process supplies the shim. Never registers a caller. */
export class CodexStatusClient implements RpcClient {
  constructor(private readonly diagnostics: RpcClient, private readonly root: string,
    private readonly pid = process.pid, private readonly birth = processStart) {}
  async call(method: string): Promise<unknown> {
    if (method !== "daemon.status") throw new Error("The diagnostics client only supports status");
    let observed: string | undefined;
    try { observed = await this.birth(this.pid); } catch { /* Unknown is not ownership. */ }
    let raw: unknown;
    let compatible = true;
    try { raw = await this.diagnostics.call(method, observed ? { caller: {
      vendor: "codex", vendor_session_id: this.root, pid: this.pid, process_started_at: observed,
    } } : {}); } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (!observed || (code !== -32602 && code !== -32601)) throw error;
      compatible = false;
      raw = await this.diagnostics.call(method, {});
    }
    const result = Status.parse(raw);
    const hook_observations = await readHookObservations(this.root);
    if (observed && compatible && result.caller) return { ...result, hook_observations };
    return { ...result, hook_observations, caller: { state: "unverified", recovery: "Caller ownership was not verified. Update the local daemon and retry status." },
      health: { ...result.health, state: "degraded", issues: [...result.health.issues, "Caller registration unverified; session delivery is not verified."] } };
  }
  close(): void {}
}
