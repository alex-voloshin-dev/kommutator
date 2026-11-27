import { describe, expect, it } from "vitest";
import { normalizeRemote, Projects } from "../src/project.js";

describe("project identity", () => {
  it("normalizes SSH/HTTPS remotes and removes credentials/query strings", () => {
    expect(normalizeRemote("git@GitHub.com:Owner/repo.git")).toBe("github.com/Owner/repo");
    expect(normalizeRemote("https://user:secret@GitHub.com/Owner/repo.git?token=secret")).toBe("github.com/Owner/repo");
    expect(normalizeRemote("file:///local/path")).toBeUndefined();
  });
  it("prefers remote and otherwise the current caller project before cwd basename", async () => {
    const projects = new Projects(async (cwd) => cwd === "/remote" ? "github.com/Owner/repo" : undefined);
    expect(await projects.key("/remote", "override")).toBe("github.com/Owner/repo");
    expect(await projects.key("/plain", "first")).toBe("first");
    expect(await projects.key("/plain", "second")).toBe("second");
    expect(await projects.key("/plain")).toBe("plain");
  });
  it("retries an unavailable remote on a later lookup", async () => {
    let current: string | undefined;
    const projects = new Projects(async () => current);
    expect(await projects.key("/new-repo")).toBe("new-repo");
    current = "github.com/Owner/new-repo";
    expect(await projects.key("/new-repo")).toBe(current);
  });
  it("shares an in-flight negative lookup but preserves each caller's fallback", async () => {
    let finish: ((value: string | undefined) => void) | undefined;
    let calls = 0;
    const projects = new Projects(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const first = projects.key("/plain", "first");
    const second = projects.key("/plain", "second");
    expect(calls).toBe(1);
    finish?.(undefined);
    expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    const third = projects.key("/plain");
    expect(calls).toBe(2);
    finish?.("github.com/Owner/repo");
    expect(await third).toBe("github.com/Owner/repo");
  });
  it("does not retain a rejected lookup or hide its error", async () => {
    let calls = 0;
    const projects = new Projects(async () => {
      if (++calls === 1) throw new Error("lookup failed");
      return "github.com/Owner/repo";
    });
    await expect(projects.key("/repo")).rejects.toThrow("lookup failed");
    expect(await projects.key("/repo")).toBe("github.com/Owner/repo");
    expect(calls).toBe(2);
  });
  it("fresh observation bypasses positive discovery cache for explicit selections", async () => {
    let remote = "github.com/Owner/first";
    const projects = new Projects(async () => remote);
    expect(await projects.key("/repo")).toBe(remote);
    remote = "github.com/Owner/second";
    expect(await projects.observe("/repo")).toBe(remote);
    expect(await projects.key("/repo")).toBe("github.com/Owner/first");
  });
  it("retains a successful lookup for this daemon lifetime", async () => {
    let calls = 0;
    const projects = new Projects(async () => { calls++; return "github.com/Owner/repo"; });
    expect(await projects.key("/repo", "first")).toBe("github.com/Owner/repo");
    expect(await projects.key("/repo", "second")).toBe("github.com/Owner/repo");
    expect(calls).toBe(1);
  });
  it("shares a rejected lookup without poisoning later callers", async () => {
    let rejectLookup: ((reason: Error) => void) | undefined;
    let calls = 0;
    const failure = new Error("temporary Git failure");
    const projects = new Projects(() => {
      if (++calls === 1) return new Promise((_resolve, reject) => { rejectLookup = reject; });
      return Promise.resolve("github.com/Owner/recovered");
    });
    const first = projects.key("/repo", "first");
    const second = projects.key("/repo", "second");
    const settled = Promise.allSettled([first, second]);
    expect(calls).toBe(1);
    rejectLookup?.(failure);
    expect(await settled).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(await projects.key("/repo", "third")).toBe("github.com/Owner/recovered");
    expect(await projects.key("/repo", "fourth")).toBe("github.com/Owner/recovered");
    expect(calls).toBe(2);
  });
});
