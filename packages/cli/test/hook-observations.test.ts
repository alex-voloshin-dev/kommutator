import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordHookObservation, readHookObservations } from "../src/hook-observations.js";
const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });
async function home() { const path = await mkdtemp(join(tmpdir(), "kom-hook-observation-")); homes.push(path); return path; }
it("bounds private slots, strips raw identities and validates collisions", async () => {
  const path = await home();
  for (let i = 0; i < 70; i++) await recordHookObservation("Stop", "success", `secret-root-${i}`, path, i);
  const dir = join(path, "hook-observations");
  expect(await readdir(dir)).toHaveLength(64);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  expect((await stat(join(dir, "0.json"))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(dir, "0.json"), "utf8")).not.toContain("secret-root");
  expect(await readHookObservations("secret-root-0", path)).toEqual([]);
  expect(await readHookObservations("secret-root-64", path)).toHaveLength(1);
  await writeFile(join(dir, "0.json"), '{"token":"secret"');
  expect(await readHookObservations("secret-root-64", path)).toEqual([]);
});
it("keeps attempted evidence unknown, supersedes it with success and refuses symlink files", async () => {
  const path = await home();
  await recordHookObservation("Stop", "attempted", "root", path, 0);
  expect(await readHookObservations("root", path)).toMatchObject([{ outcome: "attempted" }]);
  await recordHookObservation("Stop", "success", "root", path, 0);
  expect(await readHookObservations("root", path)).toMatchObject([{ outcome: "success" }]);
  const target = join(path, "target"); await writeFile(target, "do not overwrite");
  await symlink(target, join(path, "hook-observations", "1.json"));
  await recordHookObservation("Stop", "failed", "root", path, 1);
  expect(await readFile(target, "utf8")).toBe("do not overwrite");
});

it("ignores FIFO slots without blocking explicit diagnostics", async () => {
  const path = await home();
  await recordHookObservation("Stop", "success", "root", path, 0);
  execFileSync("mkfifo", [join(path, "hook-observations", "1.json")]);
  const started = performance.now();
  await recordHookObservation("Stop", "failed", "root", path, 1);
  expect(await readHookObservations("root", path)).toHaveLength(1);
  expect(performance.now() - started).toBeLessThan(200);
});
