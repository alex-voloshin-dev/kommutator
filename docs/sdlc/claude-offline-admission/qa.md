# Independent QA: Claude offline tracked admission

## Scope and result

Focused QA passed. The previously failed full gate remains failed evidence; this QA run is not a replacement full gate or release qualification.

## Tests added

Changed only `packages/cli/test/claude-offline.test.ts`:

- Exposed the existing fixture's actual hook peer and registration to tests.
- Added four real-core negative cases: send and ack from a retired owner, and send and ack from a higher-generation-superseded owner.
- Each first pins a valid MCP/Claude shim, changes authority through the actual DaemonCore hook interface, disconnects the synthetic hub, and attempts the stale mutation.
- Each verifies an error/unknown result, no `operation.submit` dispatch, no message.send/receipt.mark outbox row and zero mutation observations.

These exercise actual binding/currentOwner/registration fences, rather than only mocked error codes. No implementation, schema, runtime, timeout or production state was changed.

## Checks actually run

1. Isolated the three unchanged hub scenarios that failed in the engineer's full run, with default timeouts and sequential test-file execution:

   `pnpm --filter @kommutator/hub exec vitest run test/invariants.test.ts test/resync-migration.test.ts test/server.test.ts --no-file-parallelism --testNamePattern 'upgrades schema 6 atomically|second index fails from 5|VACUUM INTO backup contains'`

   **3 passed**, 21 unrelated cases filtered/skipped. Runtime 9.96 s, started 2026-11-21 17:46:23 UTC and completed at 17:46:33 UTC. Log: `/tmp/kom-offline-qa-hub-isolated.log`.

2. After adding four tests, ordered `pnpm -r build`, then `pnpm -r typecheck`: both passed. Logs `/tmp/kom-offline-qa-build.log` and `/tmp/kom-offline-qa-typecheck.log`. Build began 17:46:57 UTC after the isolated hub tests ended; no concurrent build/test mutation of dist occurred.

3. Focused `claude-offline.test.ts`, `claude-resume.test.ts`, `mcp-operations.test.ts` with no file parallelism: **40/40 passed** (15 new/expanded offline cases, 12 resume, 13 MCP-operation cases), 17:47:18 UTC start, 2.40 s. Log `/tmp/kom-offline-qa-focused.log`.

4. `git diff --check` passed.

## Failures retained and limits

- Engineer's original full test gate stopped at three hub timeouts, protocol 41 passed, hub 206/209 passed. `/tmp/kom-offline-candidate-test.log` remains authoritative evidence of that failure. Agentd/CLI full suites were not reached there.
- The isolated green tests do not establish why those earlier tests timed out. No attribution to host pressure is made by this QA run.
- Integration coverage uses real MCP in-memory transport, Claude wrapper, DaemonCore, SQLite and hub conformance harness. It does not exercise actual Unix socket framing/process birth or a real vendor/model session.
- Fresh ipc.hello may still await shared flush, and missing/retired registration recovery remains hub-dependent. No unconditional offline-availability guarantee is established.
- Historical report attribution is unproven; no historical uncertain operation is authorized for resend.
- Parent must run final full ordered/release qualification and review this test-only delta. This report approves focused coverage, not publication by itself.

## Defects

No additional implementation defect surfaced in the scoped QA cases.
