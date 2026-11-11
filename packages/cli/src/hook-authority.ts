import * as z from "zod";
import { Methods, PROTOCOL_VERSION } from "@kommutator/protocol";
import { saveClaudeRegistration, type ActiveClaudeRegistration } from "./plugin-context.js";
import type { Hello } from "./ipc-client.js";

export const HookEvent = z.enum(["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]);
export type HookEvent = z.infer<typeof HookEvent>;
export const Payload = z.object({
  session_id: z.string().min(1).max(200), cwd: z.string().max(1024).optional(),
  permission_mode: z.string().max(40).optional(), stop_hook_active: z.boolean().optional(),
});
export function hookHello(payload: z.infer<typeof Payload>, env: NodeJS.ProcessEnv = process.env, vendor?: "codex"): Hello {
  return Methods["ipc.hello"].parse({
    client: "hook", protocol_version: PROTOCOL_VERSION, pid: process.pid, ppid: process.ppid,
    cwd: payload.cwd ?? process.cwd(), vendor_session_id: payload.session_id,
    vendor: vendor ?? (env.CLAUDE_CODE_MESSAGING_SOCKET || env.CLAUDE_CODE_SESSION_ID ? "claude-code" : "other"),
    ...(!vendor && env.CLAUDE_CODE_MESSAGING_SOCKET ? { endpoint: env.CLAUDE_CODE_MESSAGING_SOCKET } : {}),
    ...(!vendor && env.CLAUDE_CODE_MESSAGING_TOKEN ? { token: env.CLAUDE_CODE_MESSAGING_TOKEN } : {}),
    ...(!vendor && payload.permission_mode ? { permission_mode: payload.permission_mode } : {}),
    ...(env.KOM_PROJECT ? { project_key: env.KOM_PROJECT } : {}),
    ...(!vendor && env.KOM_CLAUDE_INBOUND_POLICY ? { inbound_policy: env.KOM_CLAUDE_INBOUND_POLICY } : {}),
  });
}

export async function readInput(): Promise<unknown> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    if (Buffer.byteLength(text) > 1_048_576) throw new Error("Hook input too large");
  }
  return JSON.parse(text) as unknown;
}

export interface HookPreparation { payload: unknown; observed?: ActiveClaudeRegistration }

/** Capture only vendor-observed SessionStart authority before loading delivery code. */
export async function prepareHook(rawEvent: string | undefined, args: string[]): Promise<HookPreparation> {
  const event = HookEvent.parse(rawEvent);
  if (args.length !== 0 && !(args.length === 2 && args[0] === "--vendor" && args[1] === "codex")) throw new Error("Invalid hook vendor");
  const payload = Payload.parse(await readInput());
  if (event === "SessionStart" && args.length === 0 && process.env.KOM_PLUGIN_PROFILE === "claude-code") {
    const observed = await saveClaudeRegistration(hookHello(payload));
    return { payload, ...(observed ? { observed } : {}) };
  }
  return { payload };
}
