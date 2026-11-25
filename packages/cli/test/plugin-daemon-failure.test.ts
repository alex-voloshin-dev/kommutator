import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn(), options: vi.fn() }));
vi.mock("../src/ipc-client.js", async original => ({
  ...await original<typeof import("../src/ipc-client.js")>(),
  IpcClient: class { constructor(options: unknown) { mocks.options(options); } call = mocks.call; close = mocks.close; },
}));
import { IpcError } from "../src/ipc-client.js";
import { pluginDaemonDiagnostics, requirePluginDaemon } from "../src/plugin-daemon.js";
afterEach(() => vi.resetAllMocks());
it.each(["ipc-connect", "ipc-hello", "ipc-request"] as const)("retains %s timeout evidence without raw errors or a new probe", async phase => {
  mocks.call.mockRejectedValue(new IpcError("private token /private/socket", undefined, { phase, reason: "timeout" }));
  const result = await pluginDaemonDiagnostics(false, 123);
  expect(result).toMatchObject({ daemon: "unavailable", probe_failure: { method: "daemon.status", phase, reason: "timeout", code: null } });
  expect(JSON.stringify(result)).not.toMatch(/private token|\/private\/socket/);
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ lazyStart: false, timeoutMs: 123 }));
  expect(mocks.call.mock.calls).toEqual([["daemon.status"]]);
  expect(mocks.close).toHaveBeenCalledOnce();
  mocks.call.mockClear(); mocks.close.mockClear();
  const failure: unknown = await requirePluginDaemon().catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) throw new Error("missing probe failure");
  expect(failure.message).toContain(`Probe failure: ${JSON.stringify(result.probe_failure)}.`);
  expect(failure.message).not.toMatch(/token|\/private/);
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ lazyStart: true, timeoutMs: 5000 }));
  expect(mocks.call.mock.calls).toEqual([["daemon.status"]]);
  expect(mocks.close).toHaveBeenCalledOnce();
});
it.each([
  null, "secret remote text", new Error("secret remote text"),
  { code: "secret", diagnostic: { phase: "secret", reason: "secret", token: "secret" } },
  { code: 123456, diagnostic: [] },
])("projects malformed/non-error diagnostic input to fixed unknown fields: %#", async failure => {
  mocks.call.mockRejectedValue(failure);
  expect((await pluginDaemonDiagnostics()).probe_failure).toEqual({ method: "daemon.status", phase: "unknown", reason: "unexpected", code: null });
});
it("preserves only known codes and does not echo remote RPC errors", async () => {
  mocks.call.mockRejectedValue(new IpcError("secret remote payload", -32031, { phase: "ipc-request", reason: "rpc-rejected" }));
  const result = await pluginDaemonDiagnostics();
  expect(result.probe_failure).toEqual({ method: "daemon.status", phase: "ipc-request", reason: "rpc-rejected", code: -32031 });
  expect(JSON.stringify(result)).not.toContain("secret");
});
it.each(["ENOENT", "ECONNREFUSED"])("retains stopped behavior for %s", async code => {
  mocks.call.mockRejectedValue(Object.assign(new Error("secret socket path"), { code, diagnostic: { phase: "ipc-connect", reason: "transport-error" } }));
  const result = await pluginDaemonDiagnostics();
  expect(result.daemon).toBe("stopped");
  expect(result.probe_failure).toEqual({ method: "daemon.status", phase: "ipc-connect", reason: "transport-error", code });
  expect(result.recovery).toContain("No daemon was started");
});
it.each([3, 4, 5])("does not add a probe failure to a runtime contract response %s", async contract => {
  mocks.call.mockResolvedValue({ runtime_contract: contract, daemon: { version: "0.17.2" } });
  const result = await pluginDaemonDiagnostics();
  expect(result.daemon).toBe(contract === 4 ? "compatible" : "incompatible");
  expect(result).not.toHaveProperty("probe_failure");
});
