import { expect } from "vitest";

// Temporary process-level observation gate; DESIGN §19 / issue #9. Runtime timers are unchanged.
const HOOK_PROCESS_LIMIT_MS = 300;
const HOOK_PROCESS_TARGET_MS = 200;

export function expectHookProcessTime(elapsedMs: number, scenario: string): void {
  console.info(`[hook-timing] ${scenario}: ${elapsedMs.toFixed(3)} ms; target=${HOOK_PROCESS_TARGET_MS} ms; limit=${HOOK_PROCESS_LIMIT_MS} ms; above_target=${elapsedMs >= HOOK_PROCESS_TARGET_MS}`);
  expect(elapsedMs, `hook process: ${scenario}`).toBeLessThan(HOOK_PROCESS_LIMIT_MS);
}
