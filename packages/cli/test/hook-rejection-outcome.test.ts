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

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

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
