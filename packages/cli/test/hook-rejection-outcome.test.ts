import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn(), spawn: vi.fn() }));
vi.mock("../src/ipc-client.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/ipc-client.js")>(),
  IpcClient: class { call = mocks.call; close = mocks.close; }, spawnDaemon: mocks.spawn,
}));
import { runHook } from "../src/hooks.js";
import { readHookObservations } from "../src/hook-observations.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it("persists a failed registration outcome when the hook and its diagnostic flush complete", async () => {
  const home = await mkdtemp(join(tmpdir(), "kom-rejected-hook-outcome-"));
  vi.stubEnv("KOM_HOME", home);
  vi.stubEnv("KOM_PLUGIN_PROFILE", "");
  mocks.call.mockRejectedValue(Object.assign(new Error("Synthetic registration rejection"), { code: -32020 }));
  try {
    // Call the real hook to completion without the separate process entrypoint deadline.
    // The IPC boundary is controlled; diagnostic serialization/storage are not mocked.
    await runHook("SessionStart", [], { payload: { session_id: "rejected-root", cwd: home } });
    expect(mocks.call.mock.calls).toEqual([["whoami"]]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(await readHookObservations("rejected-root", home)).toEqual([
      expect.objectContaining({ event: "SessionStart", outcome: "failed" }),
    ]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

it.each([
  { code: "EACCES", reason: "permission-denied" },
  { code: "EPERM", reason: "permission-denied" },
  { code: "EROFS", reason: "read-only-filesystem" },
])("projects only allowlisted $code diagnostics", async ({ code, reason }) => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-permission-"));
  vi.stubEnv("KOM_HOME", home); vi.stubEnv("KOM_PLUGIN_PROFILE", "");
  mocks.call.mockRejectedValue(Object.assign(new Error("secret token /private/path"), {
    code, diagnostic: { phase: "SECRET /raw/method", reason: "SECRET reason" },
  }));
  try {
    await runHook("SessionStart", [], { payload: { session_id: "root", cwd: home } });
    const rows = await readHookObservations("root", home);
    expect(rows).toMatchObject([{ outcome: "failed", reason, phase: "whoami" }]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|private\/path|secret token/);
    expect(mocks.spawn).not.toHaveBeenCalled();
  } finally { await rm(home, { recursive: true, force: true }); }
});

it.each([
  { event: "PostToolUse", code: -32020, reason: "registration-rejected" },
  { event: "Stop", code: -32030, reason: "hub-unavailable" },
])("persists exact $event evidence after a completed flush with rejected acknowledgement", async ({ event, code, reason }) => {
  const home = await mkdtemp(join(tmpdir(), "kom-hook-ack-detail-"));
  vi.stubEnv("KOM_HOME", home); vi.stubEnv("KOM_PLUGIN_PROFILE", "");
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk, encoding, callback) => {
    output.push(String(chunk));
    if (typeof encoding === "function") encoding(); else callback?.();
    return true;
  });
  mocks.call.mockImplementation(async (method: string) => {
    if (method === "hook.poll") return { block: true, headers: [{ id: "one", seq: 1, from: "peer@host", kind: "dm", priority: "normal",
      preview: "visible", thread_id: "one", created_at: "2026-11-24T00:00:00.000Z", state: "unread", wake: true }] };
    throw Object.assign(new Error("private remote error"), { code });
  });
  try {
    await runHook(event, event === "Stop" ? ["--vendor", "codex"] : [], { payload: { session_id: "root", cwd: home } });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("visible");
    expect(mocks.call.mock.calls).toEqual([["hook.poll", { event }], ["hook.ack", { ids: ["one"] }]]);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.spawn).not.toHaveBeenCalled();
    const observations = await readHookObservations("root", home);
    expect(observations).toHaveLength(1);
    expect(observations).toMatchObject([
      { event, outcome: "output-written-ack-unverified", reason, phase: "hook-ack" },
    ]);
    expect(JSON.stringify(observations)).not.toContain("private remote error");
  } finally { await rm(home, { recursive: true, force: true }); }
});
