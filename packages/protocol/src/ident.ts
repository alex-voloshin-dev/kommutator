// One identifier grammar for everything that ends up inside an address: session names,
// host short names, roles. Lowercase only; the address parser lowercases its input, so
// `Author@Laptop` and `author@laptop` are the same session.

import * as z from "zod";

export const IDENT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export const Ident = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(IDENT_RE, "expected [a-z0-9][a-z0-9_-]{0,62}"));

export function isIdent(s: string): boolean {
  return IDENT_RE.test(s);
}

/** Best-effort conversion of an arbitrary string into a valid identifier. */
export function toIdent(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\.local$/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return s.length > 0 ? s : "x";
}
