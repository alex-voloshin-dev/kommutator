// Codex CLI / ChatGPT Work (local mode) adapter (DESIGN.md §9).
//
// M2 ships hook mode: no native wake; delivery happens through hook-injected headers and
// the Stop-time poll. Native wake via the app-server (turn/start, turn/steer over the unix
// socket, WebSocket framing after an HTTP upgrade) is added once spike 02 passes.
//
// Liveness: Codex hooks expose no pid, so `pid` here is the stdio shim's own pid, reported
// in its IPC hello; the shim dies with the session.

import type { Message } from "@kommutator/protocol";
import type { Adapter, DeliveryResult, LocalSession } from "./types.js";

export const codexAdapter: Adapter = {
  vendor: "codex",
  capability: "hook",

  async deliver(_local: LocalSession, _message: Message, _wake: boolean): Promise<DeliveryResult> {
    // Nothing to push in hook mode: the next PostToolUse/UserPromptSubmit/Stop hook pulls
    // the inbox from agentd. TODO(after spike 02): app-server client.
    return { outcome: "inbox" };
  },

  async isAlive(local: LocalSession): Promise<boolean> {
    if (!local.pid) return false;
    try {
      process.kill(local.pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};
