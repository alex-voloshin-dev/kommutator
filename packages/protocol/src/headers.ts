// Inbox headers: what a hook injects into the agent's context and what `inbox` returns.
// A header always carries the hub-assigned message `id` (for read/ack/reply_to) and `seq`
// (the inbox cursor). The preview is the first line of the body, capped.
//
// Length unit, everywhere in this file: **Unicode code points** (`Array.from(s).length`),
// so an emoji counts once and a surrogate pair is never split. The schema check below uses
// the same unit (T02 in the 2026-10-25 review); the vendor's 10,000-character cap on hook
// output is in UTF-16 units, which is why `injectionBudget` leaves a wide margin.

import * as z from "zod";
import { LIMITS, MessageId, MessageKind, Priority, ReceiptState } from "./schemas.js";

export function codePoints(s: string): number {
  return Array.from(s).length;
}

/** `max` in code points, not UTF-16 units — matches `makePreview`. */
const codePointString = (max: number) =>
  z.string().refine((s) => codePoints(s) <= max, { message: `expected at most ${max} code points` });

export const MessageHeader = z.object({
  id: MessageId,
  seq: z.number().int().positive(),
  from: z.string().max(130),
  kind: MessageKind,
  priority: Priority,
  subject: z.string().max(LIMITS.subject).optional(),
  preview: codePointString(LIMITS.preview),
  thread_id: MessageId,
  created_at: z.string().datetime(),
  state: ReceiptState,
  /** The hub's wake decision for this delivery, stored on the row; the Stop-time poll filters on it. */
  wake: z.boolean(),
});
export type MessageHeader = z.infer<typeof MessageHeader>;

/** First line of the body, truncated to LIMITS.preview code points (never splits a surrogate pair). */
export function makePreview(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const chars = Array.from(firstLine);
  if (chars.length <= LIMITS.preview) return firstLine;
  return chars.slice(0, LIMITS.preview - 1).join("") + "…";
}

/** One header as a hook renders it into the agent's context. `fyi` is shown so the model
 *  can tell informational posts from requests (H03). */
export function renderHeader(h: MessageHeader): string {
  const subject = h.subject ? ` ${h.subject} —` : "";
  const prio = h.priority === "fyi" ? " fyi" : "";
  return `[kommutator #${h.seq} id=${h.id} from=${h.from} ${h.kind}${prio}]${subject} ${h.preview}`;
}

export interface PackedHeaders {
  /** Headers that fit the budget, in order; only these may be marked read. */
  shown: MessageHeader[];
  /** How many did not fit; they stay unread. */
  omitted: number;
  /** The text to inject; empty when nothing fits (then nothing is marked read). */
  text: string;
}

const trailerFor = (omitted: number) => `+${omitted} more unread — call inbox() to see them`;

/**
 * Fit as many headers as the budget allows (DESIGN.md §6): at most `maxCount`, and the
 * rendered text at most `budgetChars` code points including the trailer when one is
 * needed. Headers that do not fit are counted, not shown, and stay unread.
 *
 * Guarantee: `codePoints(result.text) <= budgetChars` for every budget ≥ 0. A budget too
 * small for even the trailer yields empty text and `omitted === headers.length`.
 */
export function packHeaders(headers: MessageHeader[], opts: { maxCount?: number; budgetChars?: number } = {}): PackedHeaders {
  const maxCount: number = opts.maxCount ?? LIMITS.headersPerInjection;
  const budgetChars: number = opts.budgetChars ?? LIMITS.injectionBudget;
  const total = headers.length;
  const candidates = headers.slice(0, Math.max(0, maxCount));
  const lines = candidates.map(renderHeader);

  // Exact cost of showing the first k headers: the joined lines plus the trailer that
  // would actually be printed (none when nothing is omitted). Pick the largest k that
  // fits — a greedy reserve-as-you-go pass can stop early when the trailer is longer than
  // the headers it would replace (H04 in the 2026-10-25 six-hats review).
  const costOf = (k: number): number => {
    let used = 0;
    for (let i = 0; i < k; i++) used += codePoints(lines[i]!) + (i > 0 ? 1 : 0);
    const omittedAfter = total - k;
    if (omittedAfter > 0) used += codePoints(trailerFor(omittedAfter)) + (k > 0 ? 1 : 0);
    return used;
  };

  let k = candidates.length;
  while (k > 0 && costOf(k) > budgetChars) k--;

  const shown = candidates.slice(0, k);
  const omitted = total - k;
  const out = lines.slice(0, k);
  if (omitted > 0) {
    const trailer = trailerFor(omitted);
    // With k === 0 the trailer alone may still exceed a tiny budget: then emit nothing and
    // let `omitted` carry the information.
    if (costOf(k) <= budgetChars) out.push(trailer);
  }
  return { shown, omitted, text: out.join("\n") };
}
