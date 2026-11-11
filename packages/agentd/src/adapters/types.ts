import type { Message, Session } from "@kommutator/protocol";

/**
 * A vendor adapter knows how to reach sessions of one vendor on this host.
 * All vendor-specific code lives behind this interface (DESIGN.md §2 rule).
 */
export interface Adapter {
  readonly vendor: Session["vendor"];

  /** Transport ceiling; effective per-session capability also depends on verified vendor policy. */
  readonly capability: Session["capability"];

  /**
   * Deliver a message to a local session.
   *
   * `wake === true`: attempt the vendor's native path if there is one; recipient policy may
   * still hold/refuse it. `wake === false`: never start a turn; the message stays in the
   * hub inbox for the next hook injection or `inbox()` call, so a `native` adapter does
   * nothing here and returns `{ outcome: "inbox" }`.
   *
   * Resolves with the available delivery evidence; rejects only on transport failure.
   */
  deliver(session: LocalSession, message: Message, wake: boolean): Promise<DeliveryResult>;

  /** Cheap owner-process liveness probe; delivery availability is separate. */
  isAlive(session: LocalSession): Promise<boolean>;

  /** Positive durable vendor retirement evidence; missing evidence must return false. */
  isEnded?(session: LocalSession, stateHome: string): Promise<boolean>;
}

export type DeliveryResult =
  /** Left in the inbox on purpose (wake=false, or a pull-only adapter). */
  | { outcome: "inbox" }
  /**
   * Vendor confirmed it accepted the message. The hub marks the delivery `read` on this
   * outcome only once spike 01 has shown that the vendor's acknowledgement means "handed
   * to the model" rather than "queued"; until then no adapter returns it (DESIGN.md §5).
   */
  | { outcome: "accepted"; raw?: string }
  /** Vendor answered with a hold/refusal; stays `unread`, surfaced in `kom status`. */
  | { outcome: "rejected"; raw: string }
  /** Bytes were written but the vendor's answer is unknown or absent; stays `unread`. */
  | { outcome: "written"; raw?: string };

/** What agentd keeps about a session on this host, beyond the protocol Session record. */
export interface LocalSession {
  session: Session;
  pid?: number;
  /** Vendor-specific delivery endpoint, e.g. the Claude Code inbox socket path. */
  endpoint?: string;
  /** Vendor-specific secret, e.g. CLAUDE_CODE_MESSAGING_TOKEN. Never leaves this host. */
  token?: string;
  /**
   * Claude Code's permission_mode when a hook supplies it (absent at SessionStart in
   * spike 01 on 2.1.310). Missing means unknown. A token alone does not establish bypass
   * delivery. Host-local only.
   */
  permissionMode?: string;
  /** User-declared effective inbound policy for this launch; not vendor attestation. */
  inboundPolicy?: "default" | "accept" | "hold" | "refuse";
  /** Host process birth identity, checked by the registry to reject PID reuse. */
  processStartedAt?: string;
  /** Vendor conversation generation within this process owner. */
  ownerGeneration?: number;
}
