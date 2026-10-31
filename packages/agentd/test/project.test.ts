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
});
