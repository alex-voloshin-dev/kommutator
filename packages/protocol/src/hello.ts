import * as z from "zod";

export const PROTOCOL_VERSION = 1;
export const RUNTIME_CONTRACT = 4;
export const Vendor = z.enum(["claude-code", "codex", "chatgpt-work", "other"]);

export const IpcHello = z.object({
  client: z.enum(["shim", "hook", "cli"]),
  protocol_version: z.number().int(),
  runtime_contract: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  pid: z.number().int().positive(),
  ppid: z.number().int().positive().optional(),
  cwd: z.string().max(1024).optional(),
  /** Caller-scoped KOM_PROJECT fallback; daemon may prefer a normalized Git remote. */
  project_key: z.string().min(1).max(300).optional(),
  vendor: Vendor.optional(),
  /**
   * The vendor's own session id. A hook always has it (`session_id` in the payload). A shim
   * reads it from the environment Claude Code gives its MCP servers (`CLAUDE_CODE_SESSION_ID`,
   * verified on 2.1.310 in spike 1). Claude binding also requires observed parent PID/birth:
   * concurrent processes can resume the same vendor ID. Never bind by cwd or "most recent" (DESIGN §9).
   */
  vendor_session_id: z.string().max(200).optional(),
  /** Monotonic Claude conversation generation within one observed PID/process birth. */
  owner_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  /** MCP clientInfo as the agent sent it (shim only). */
  client_info: z.object({ name: z.string().max(100), version: z.string().max(40).optional() }).optional(),
  /** Vendor-specific delivery facts harvested by a hook (Claude: socket path, token, permission mode). Host-local. */
  endpoint: z.string().max(1024).optional(),
  token: z.string().max(512).optional(),
  permission_mode: z.string().max(40).optional(),
  /** Per-launch user declaration; never changes vendor settings or leaves this host. */
  inbound_policy: z.enum(["default", "accept", "hold", "refuse"]).optional(),
});
