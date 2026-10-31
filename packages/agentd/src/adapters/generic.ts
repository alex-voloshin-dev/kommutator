// Generic MCP client adapter (DESIGN.md §9): any agent that can run the stdio shim but has
// no hooks and no native push. Registration from MCP `initialize` (clientInfo, roots),
// liveness = the shim process, delivery = `inbox()` on demand.

import type { Message } from "@kommutator/protocol";
import type { Adapter, DeliveryResult, LocalSession } from "./types.js";

export const genericAdapter: Adapter = {
  vendor: "other",
  capability: "none",

  async deliver(_local: LocalSession, _message: Message, _wake: boolean): Promise<DeliveryResult> {
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
