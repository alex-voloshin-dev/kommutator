// Addressing grammar for the `to` field (DESIGN.md §3):
//
//   author@laptop            one session by handle
//   @role:executor           every session with that role
//   topic:project:<key>      every member of a topic
//   all                      everyone
//
// Names, hosts and roles follow the identifier grammar in ident.ts; input is lowercased.

import { IDENT_RE } from "./ident.js";

export type Address =
  | { kind: "session"; name: string; host: string }
  | { kind: "role"; role: string }
  | { kind: "topic"; topic: string }
  | { kind: "all" };

export function parseAddress(raw: string): Address {
  const s = raw.trim();
  if (s.toLowerCase() === "all") return { kind: "all" };

  if (s.toLowerCase().startsWith("@role:")) {
    const role = s.slice("@role:".length).toLowerCase();
    if (!IDENT_RE.test(role)) throw new AddressError(raw, "invalid role");
    return { kind: "role", role };
  }

  if (s.startsWith("topic:")) {
    const topic = s.slice("topic:".length);
    if (topic.length === 0) throw new AddressError(raw, "empty topic");
    return { kind: "topic", topic };
  }

  const at = s.lastIndexOf("@");
  if (at > 0 && at < s.length - 1) {
    const name = s.slice(0, at).replace(/^@/, "").toLowerCase();
    const host = s.slice(at + 1).toLowerCase();
    if (!IDENT_RE.test(name) || !IDENT_RE.test(host)) throw new AddressError(raw, "invalid handle");
    return { kind: "session", name, host };
  }

  throw new AddressError(raw, "unrecognized address");
}

export function formatAddress(a: Address): string {
  switch (a.kind) {
    case "all":
      return "all";
    case "role":
      return `@role:${a.role}`;
    case "topic":
      return `topic:${a.topic}`;
    case "session":
      return `${a.name}@${a.host}`;
  }
}

export function makeHandle(name: string, host: string): string {
  return `${name}@${host}`;
}

export class AddressError extends Error {
  constructor(
    public readonly raw: string,
    reason: string,
  ) {
    super(`bad address "${raw}": ${reason}`);
    this.name = "AddressError";
  }
}
