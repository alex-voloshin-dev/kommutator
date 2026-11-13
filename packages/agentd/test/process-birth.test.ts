import { expect, it } from "vitest";
import { processStart, processStartSync, linuxProcessBirth, compareProcessBirth } from "../src/process.js";

const boot = "01234567-89ab-cdef-0123-456789abcdef";
it("parses exact start ticks after an unusual comm without number rounding", () => {
  const stat = `42 (name with ) and ( spaces) S ${Array(18).fill("0").join(" ")} 9007199254740993123 0`;
  expect(linuxProcessBirth(stat, boot)).toBe(`linux-v1:${boot}:9007199254740993123`);
  expect(linuxProcessBirth(stat.replace("9007199254740993123", "invalid"), boot)).toBeUndefined();
  expect(linuxProcessBirth(stat, "bad boot")).toBeUndefined();
});
it("keeps one live Linux process identical across timezone changes", async () => {
  if (process.platform !== "linux") return;
  const previous = process.env.TZ;
  try {
    process.env.TZ = "UTC"; const utc = await processStart(process.pid);
    process.env.TZ = "America/New_York"; const local = await processStart(process.pid);
    expect(utc).toMatch(/^linux-v1:/); expect(local).toBe(utc);
    expect(processStartSync(process.pid)).toBe(utc);
    expect(await processStart(-1)).toBeUndefined();
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
it("only proves replacement for comparable versioned births", () => {
  const a = `linux-v1:${boot}:123`;
  expect(compareProcessBirth(a, a)).toBe("same");
  expect(compareProcessBirth(a, `linux-v1:${boot}:124`)).toBe("different");
  expect(compareProcessBirth(a, "Tue Nov 10 07:01:09 2026")).toBe("unverified");
  expect(compareProcessBirth(undefined, a)).toBe("unverified");
  expect(compareProcessBirth("ps-utc-v1:Tue Nov 10 07:01:09 2026", "ps-utc-v1:Tue Nov 10 07:01:10 2026")).toBe("different");
});
