import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "citty";
import { boardCommand } from "../src/board.js";

const ipc = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn(), create: vi.fn() }));
vi.mock("../src/ipc-client.js", () => ({
  cliHello: () => ({ client: "cli" }),
  IpcClient: class {
    constructor(options: unknown) { ipc.create(options); }
    call = ipc.call;
    close = ipc.close;
  },
}));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
const entry = { topic: "kommutator-feedback", key: "decisions", body: "Board body", version: 2,
  author: "author@host", protected: false, updated_at: "2026-11-08T00:00:00Z" };
const selection = ["--session", "session-id", "--topic", "kommutator-feedback"];

describe("board CLI", () => {
  it.each(["get", "list"])("%s reads validated JSON without starting a daemon", async command => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    ipc.call.mockResolvedValue({ entries: [entry] });
    await runCommand(boardCommand, { rawArgs: [command, ...selection, ...(command === "get" ? ["--key", "decisions"] : [])] });
    expect(ipc.call).toHaveBeenCalledExactlyOnceWith("board.get", { session_id: "session-id", topic: entry.topic,
      ...(command === "get" ? { key: entry.key } : {}) });
    expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual({ entries: [entry] });
    expect(ipc.create).toHaveBeenCalledWith(expect.objectContaining({ lazyStart: false, retries: 0 }));
    expect(ipc.close).toHaveBeenCalledOnce();
  });
  it("prints an empty entries array for a missing key", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    ipc.call.mockResolvedValue({ entries: [] });
    await runCommand(boardCommand, { rawArgs: ["get", ...selection, "--key", "missing"] });
    expect(JSON.parse(output.mock.calls[0]![0] as string)).toEqual({ entries: [] });
  });
  it.each([
    ["get", ...selection], ["list", "--topic", "global"], ["list", "--session", "session-id"],
    ["get", ...selection, "--key", ""], ["list", "--session", "", "--topic", "global"],
    ["get", ...selection, "--key", "x".repeat(121)],
  ])("rejects invalid or incomplete arguments before IPC: %j", async (...rawArgs) => {
    await expect(runCommand(boardCommand, { rawArgs })).rejects.toThrow();
    expect(ipc.call).not.toHaveBeenCalled();
  });
  it.each([new Error("unavailable"), { entries: [{ ...entry, version: -1 }] }])("fails without output and closes on errors", async result => {
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    if (result instanceof Error) ipc.call.mockRejectedValue(result);
    else ipc.call.mockResolvedValue(result);
    await expect(runCommand(boardCommand, { rawArgs: ["list", ...selection] })).rejects.toThrow();
    expect(output).not.toHaveBeenCalled();
    expect(ipc.close).toHaveBeenCalledOnce();
    expect(ipc.call).toHaveBeenCalledOnce();
  });
});
