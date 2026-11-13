import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  call: vi.fn(), close: vi.fn(), observe: vi.fn(), status: vi.fn(), active: vi.fn(), forget: vi.fn(),
}));
vi.mock("../src/ipc-client.js", () => ({
  IpcClient: class { call = mocks.call; close = mocks.close; }, spawnDaemon: vi.fn(),
}));
vi.mock("../src/plugin-daemon.js", () => ({ pluginDaemonStatus: mocks.status }));
vi.mock("../src/plugin-conflicts.js", () => ({ pluginConflicts: async () => [] }));
vi.mock("../src/plugin-context.js", () => ({
  activeClaudeRegistration: mocks.active, forgetClaudeRegistration: mocks.forget,
  savePluginContext: vi.fn(), saveClaudeRegistration: vi.fn(),
}));
vi.mock("../src/hook-observations.js", () => ({ recordHookObservation: mocks.observe }));
import { runHook } from "../src/hooks.js";

const active = {
  hello: { client: "hook" as const, protocol_version: 1, runtime_contract: 4, pid: 100, ppid: process.ppid,
    vendor: "claude-code" as const, vendor_session_id: "ended-conversation", owner_generation: 3, cwd: "/repo" },
  generation: "birth:3", birth: "birth",
};
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

it.each([
  { code: -32020, daemon: "compatible", outcome: "retired-locally" },
  { code: -32030, daemon: "compatible", outcome: "hub-unavailable" },
  { code: "ECONNREFUSED", daemon: "compatible", outcome: "ipc-unavailable" },
  { code: -32020, daemon: "incompatible", outcome: "daemon-incompatible" },
])("reports only established local retirement while preserving failure categories: %j", async ({ code, daemon, outcome }) => {
  vi.stubEnv("KOM_PLUGIN_PROFILE", "claude-code");
  mocks.status.mockResolvedValue(daemon);
  mocks.call.mockRejectedValue(Object.assign(new Error("terminal binding"), { code }));
  await runHook("SessionEnd", [], { payload: { session_id: "ended-conversation", cwd: "/repo" }, retired: active });
  expect(mocks.observe).toHaveBeenLastCalledWith("SessionEnd", outcome, "ended-conversation");
  expect(mocks.active).not.toHaveBeenCalled();
  expect(mocks.forget).not.toHaveBeenCalled();
  if (daemon === "compatible") expect(mocks.call).toHaveBeenCalledWith("session.gone");
  else expect(mocks.call).not.toHaveBeenCalled();
});

it("does not label a registration failure as retirement without committed end evidence", async () => {
  vi.stubEnv("KOM_PLUGIN_PROFILE", "claude-code");
  mocks.active.mockRejectedValue(Object.assign(new Error("missing authority"), { code: -32020 }));
  await runHook("SessionEnd", [], { payload: { session_id: "ended-conversation", cwd: "/repo" } });
  expect(mocks.observe).toHaveBeenLastCalledWith("SessionEnd", "identity-unavailable", "ended-conversation");
  expect(mocks.call).not.toHaveBeenCalled();
});
