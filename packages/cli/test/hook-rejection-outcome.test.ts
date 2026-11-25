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

it("keeps written output distinct from a rejected acknowledgement", async () => {
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
    throw Object.assign(new Error("private remote error"), { code: -32020 });
  });
  try {
    await runHook("PostToolUse", [], { payload: { session_id: "root", cwd: home } });
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("visible");
    expect(mocks.call.mock.calls.map(call => call[0])).toEqual(["hook.poll", "hook.ack"]);
    expect(await readHookObservations("root", home)).toMatchObject([
      { outcome: "output-written-ack-unverified", reason: "registration-rejected", phase: "hook-ack" },
    ]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
