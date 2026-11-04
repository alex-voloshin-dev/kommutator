import * as z from "zod";
import { DaemonStatusParams } from "@kommutator/protocol";
import type { ActiveClaudeRegistration } from "./plugin-context.js";
import type { RpcClient } from "./ipc-client.js";

const Status = z.object({
  health: z.object({ state: z.enum(["healthy", "degraded"]), issues: z.array(z.string()) }).passthrough(),
  caller: z.object({ state: z.enum(["active", "gone", "unavailable", "conflicting", "unverified"]) }).passthrough().optional(),
}).passthrough();
const recovery = "Run /exit, then claude --resume in the same project and trust the updated plugin hooks. Waiting or /reload-plugins alone does not restore an ended registration.";

/** Inspect this exact hook owner without registration, daemon startup or session mutation. */
export class ClaudeStatusClient implements RpcClient {
  constructor(private readonly diagnostics: RpcClient, private readonly resolve: () => Promise<ActiveClaudeRegistration>) {}

  async call(method: string): Promise<unknown> {
    if (method !== "daemon.status") throw new Error("The diagnostics client only supports status");
    let observed: ActiveClaudeRegistration | undefined;
    let params: z.infer<typeof DaemonStatusParams> = {};
    try {
      observed = await this.resolve();
      params = DaemonStatusParams.parse({ caller: {
        vendor: "claude-code", vendor_session_id: observed.hello.vendor_session_id,
        pid: observed.hello.ppid, process_started_at: observed.birth,
        ...(observed.hello.owner_generation !== undefined ? { owner_generation: observed.hello.owner_generation } : {}),
      } });
    } catch {
      observed = undefined;
    }
    const result = Status.parse(await this.diagnostics.call(method, params));
    let problem: { state: "unavailable" | "conflicting" | "unverified"; recovery: string } | undefined;
    if (!observed) problem = { state: "unavailable", recovery };
    else {
      try {
        if ((await this.resolve()).generation !== observed.generation) {
          problem = { state: "conflicting", recovery: "The conversation changed during status. Call status again for the current conversation." };
        }
      } catch { problem = { state: "unavailable", recovery }; }
      if (!problem && !result.caller) problem = { state: "unverified", recovery: "This daemon did not verify the caller registration. Update the local daemon, then call status again." };
    }
    if (!problem) return result;
    return { ...result, caller: problem, health: { ...result.health, state: "degraded",
      issues: [...result.health.issues, `Caller registration ${problem.state}; session delivery is not verified.`] } };
  }

  // The MCP server owns the shared diagnostic connection.
  close(): void {}
}
