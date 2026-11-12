import { expect, it } from "vitest";
import { Methods, PROTOCOL_VERSION, Vendor } from "../dist/index.js";
import { IpcHello, PROTOCOL_VERSION as HelloVersion, Vendor as HelloVendor } from "../dist/hello.js";

it("shares the canonical hello schema and constants between both entrypoints", () => {
  expect(Methods["ipc.hello"]).toBe(IpcHello);
  expect(Vendor).toBe(HelloVendor);
  expect(PROTOCOL_VERSION).toBe(HelloVersion);
  const minimal = { client: "hook", protocol_version: 1, pid: 1 };
  expect(IpcHello.parse({ ...minimal, unknown: true })).toEqual(minimal);
  expect(IpcHello.parse({ ...minimal, owner_generation: Number.MAX_SAFE_INTEGER })).toMatchObject({ owner_generation: Number.MAX_SAFE_INTEGER });
  for (const invalid of [
    { pid: 0 }, { ppid: 0 }, { owner_generation: 0 },
    { owner_generation: Number.MAX_SAFE_INTEGER + 1 }, { vendor: "unsupported" },
    { vendor_session_id: "x".repeat(201) }, { project_key: "" },
    { inbound_policy: "untrusted" },
  ]) expect(IpcHello.safeParse({ ...minimal, ...invalid }).success).toBe(false);
});
