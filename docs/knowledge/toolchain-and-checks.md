---
title: Toolchain and validation order
type: note
tags: [toolchain, testing]
---

# Toolchain and validation order

Use Node 24 from [.nvmrc](../../.nvmrc) and pnpm 10.18.0 from
[package.json](../../package.json). The [workspace](../../pnpm-workspace.yaml) includes
packages/*, not spikes. The existing lockfile supports frozen setup.

Run build → typecheck → test: workspace imports resolve through dist/ as declared in
[protocol/package.json](../../packages/protocol/package.json) and
[agentd/package.json](../../packages/agentd/package.json). Root pnpm typecheck already
builds; root pnpm test does not. No lint/format command is configured.

[tsconfig.base.json](../../tsconfig.base.json) enables strict NodeNext ESM,
noUncheckedIndexedAccess and exactOptionalPropertyTypes. Relative source imports use
.js suffixes; [.editorconfig](../../.editorconfig) specifies two spaces and LF.
Preserve removeNodeProtocol: false in [tsup config](../../packages/hub/tsup.config.ts)
for node:sqlite. Generated dist/ and node_modules/ are ignored.

On 2026-10-25, build and typecheck passed on Node 24.19.0 / pnpm 10.18.0; all 49 tests
passed (protocol 28, hub 13, agentd 8). At that scaffold checkpoint, CLI had no tests and used
--passWithNoTests in [its manifest](../../packages/cli/package.json). This is scaffold
coverage, not E2E coverage. Socket suites need permission to bind local Unix/TCP sockets;
the sandbox first produced listen EPERM, then the permitted run passed.

After steps 1–2 on the same date/toolchain, build/typecheck passed and all **164** tests
passed (protocol 29, hub 127, agentd 8). See the
[implementation checkpoint](../sdlc/m1-hub-conformance/implementation.md).

These are dated observations, not a promise about later revisions. Re-run the checks
for implementation changes. Full evidence and environment details are in the
[onboarding handoff](../sdlc/repo-onboarding/onboarding.md#verification).

After steps 3–4 on the same toolchain, build/typecheck and the full workspace suite passed
233 tests. QA added one cold valid-hook process test without production changes and reran
all CLI tests (29 passed). Latest package totals: **234** (protocol 30, hub 128, agentd 47,
CLI 29). CLI no longer permits zero tests. Two-shim singleton/survival and cold hook
deadline checks use real built processes with fake vendor sessions, not live Claude E2E.
See the [daemon/shim checkpoint](../sdlc/m1-daemon-shim/implementation.md).

Step 5 passed the same build/typecheck/full-test commands: **242 tests** (30/136/47/29).
Chromium 151.0.7922.34 verified the actual dashboard against the hub/harness, including
SSE reconnect and safe text rendering. [Evidence](../sdlc/m1-dashboard/implementation.md).

Step 6 repeated build/typecheck and all **242 tests** successfully after live two-Claude
acceptance. The [M1 checkpoint](../sdlc/m1-live/implementation.md) links actual production
native wake, thread/board/dashboard and daemon-survival evidence. No production changes
or new tests were needed for that run.

Step 7 passed build/typecheck and **295 tests** (30/141/49/75). Doctor includes a real
HTTP response-body stall/cancellation test; log tests cover rotation, partial UTF-8,
backpressure and signal exit even with an undrained stdout pipe. Actual Chromium passed
nine scenarios; real CLI/hub/daemon processes passed eight diagnostics/outage/recovery
checks. [Evidence](../sdlc/m1-operability/implementation.md). Full-day real-use acceptance
is still open; those smoke checks do not replace it.
