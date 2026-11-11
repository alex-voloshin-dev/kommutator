import { describe, expect, it } from "vitest";
import { AddressError, formatAddress, makeHandle, parseAddress } from "../src/address.js";
import { Ident, toIdent } from "../src/ident.js";

describe("parseAddress", () => {
  it("parses a session handle and lowercases it", () => {
    expect(parseAddress("author@laptop")).toEqual({ kind: "session", name: "author", host: "laptop" });
    expect(parseAddress("@author@laptop")).toEqual({ kind: "session", name: "author", host: "laptop" });
    expect(parseAddress("Author@Laptop")).toEqual({ kind: "session", name: "author", host: "laptop" });
  });

  it("parses roles, topics and all", () => {
    expect(parseAddress("@role:executor")).toEqual({ kind: "role", role: "executor" });
    expect(parseAddress("topic:project:github.com/avav25/kommutator")).toEqual({
      kind: "topic",
      topic: "project:github.com/avav25/kommutator",
    });
    expect(parseAddress("all")).toEqual({ kind: "all" });
  });

  it("rejects garbage", () => {
    expect(() => parseAddress("")).toThrow(AddressError);
    expect(() => parseAddress("author")).toThrow(AddressError);
    expect(() => parseAddress("@role:")).toThrow(AddressError);
    expect(() => parseAddress("a b@host")).toThrow(AddressError);
    expect(() => parseAddress("author@alexs-macbook-air.local")).toThrow(AddressError);
  });

  it("explains address syntax without guessing topic or session existence", () => {
    for (const raw of ["kommutator-feedback", "unknown-topic", "author"]) {
      expect(() => parseAddress(raw)).toThrow("use topic:<name>, <name>@<host>, @role:<role>, or all");
    }
  });

  it("round-trips through formatAddress", () => {
    for (const raw of ["author@laptop", "@role:executor", "topic:global", "all"]) {
      expect(formatAddress(parseAddress(raw))).toBe(raw);
    }
  });
});

describe("identifiers", () => {
  it("accepts what the address grammar accepts, lowercased", () => {
    expect(Ident.parse("Reviewer")).toBe("reviewer");
    expect(Ident.parse("srv-01")).toBe("srv-01");
    expect(() => Ident.parse("a b")).toThrow();
    expect(() => Ident.parse("")).toThrow();
    expect(() => Ident.parse("-x")).toThrow();
    expect(() => Ident.parse("x@y")).toThrow();
  });

  it("every accepted session name/host yields a parseable handle", () => {
    for (const [name, host] of [["Reviewer", "Laptop"], ["a1", "srv"], ["x_y-z", "h0st"]] as const) {
      const handle = makeHandle(Ident.parse(name), Ident.parse(host));
      expect(parseAddress(handle).kind).toBe("session");
    }
  });

  it("toIdent sanitizes hostnames and repo names", () => {
    expect(toIdent("Alexs-MacBook-Air.local")).toBe("alexs-macbook-air");
    expect(toIdent("github.com/avav25/kommutator")).toBe("github-com-avav25-kommutator");
    expect(toIdent("   ")).toBe("x");
    expect(toIdent("---weird---")).toBe("weird");
  });
});
