# Claude in-process resume binding

## Scope and assumptions

A Claude process may start its MCP server before resuming a different conversation.
The process remains the same, while a trusted SessionStart reports a new vendor ID.
The fix uses those observed hook facts rather than trusting the MCP launch environment,
searching by cwd, or creating a manual registration. Concurrent process owners remain
separate. Codex per-call metadata behavior is unchanged.

## Implementation

- `packages/cli/src/plugin-context.ts`: immutable numbered registration records under an
  exact PID/process-birth directory; atomic hard-link publication and generation-specific
  end tombstones. There are no persistent locks to strand on the hook deadline.
- `packages/cli/src/claude.ts` and `mcp.ts`: resolve each call's current hook generation,
  replace immutable pinned IPC clients on changes, and check asynchronous boundaries.
  Already dispatched mutations are never replayed against another conversation.
- `packages/cli/src/hooks.ts`: pass observed generation to IPC and retire only the captured
  generation on SessionEnd. Delayed events for another active vendor ID are ignored.
- `packages/protocol/src/schemas.ts`, daemon core/registry/wake: optional local owner
  generation, stale-generation rejection, prior conversation retirement and wake fencing.
  Runtime compatibility is 3; local state schema 2 migrates schema 1 without dropping replay
  or delivery data. The hub schema and protocol version remain unchanged.
- Setup status text now explicitly describes stored connection configuration; configured
  does not mean that the current session is registered or successfully bound.

## Verification boundary

Tests cover stale/absent launch IDs, A → B → A, generation-specific end handling,
legacy fallback restrictions, concurrent owner isolation, preflight and mutation races,
stale wake/liveness completion, persistent fences and schema migration. The integrating
maintainer records final full-suite, process/artifact and review results separately.

The first full test run passed build/typecheck, protocol 33, hub 141 and agentd 71 tests.
Two CLI process tests failed with unavailable registration under parallel test load.
Subsequent isolated runs passed, so a timing root cause was not established. A separate
verified race in SessionEnd's second registration lookup was fixed by retaining its exact
captured generation; this also avoids redundant owner probes. Deadlines were not increased.

Actual interactive vendor resume and native delivery after resume require recorded vendor
execution evidence; synthetic process success alone does not establish those gates.

Final engineer gate after the captured-generation fix: `pnpm -r build`,
`pnpm -r typecheck`, then `pnpm -r test` all passed sequentially. The suite reported
33 protocol + 141 hub + 72 agentd + 139 CLI tests (385 total), including QA's then-current
process test file. `git diff --check` passed. No production services, plugin installation,
Git commits or publication were performed by the implementation agent.

## Artifact regression follow-up

QA's expanded exported-plugin test found that a repeated SessionStart for the same active
conversation unnecessarily incremented hub incarnation. The final delta preserves its
existing identity/incarnation/name/role while refreshing the generation fence and invalidating
old peers/wake work. Different conversations are still retired. A daemon regression test
asserts both state preservation and stale-peer rejection; the existing artifact assertion
was preserved. Endpoint-change launch replacement behavior remains unchanged.

## Hook-budget diagnostic and test scheduling

A diagnostic run with temporary stage timing established that concurrent Vitest file
transforms and process suites consumed most of the hook's fixed budget: module loading
alone took approximately 79–110 ms, with registration publication taking 17–42 ms in the
sample. The 140 ms entrypoint deadline was observed firing during hook processing; the
hook still exited zero with empty stdout as required. This explains lost best-effort
registration under that test workload; it is not evidence that hooks always complete
under arbitrary production load.

CLI test files now run serially to avoid unrelated test-file CPU interference with
wall-clock process assertions. Explicit concurrent-owner, concurrent registration and
race scenarios inside the tests remain unchanged, as do the production 140 ms deadline
and <200 ms acceptance assertions. No hook retries or relaxed assertions were added.
Temporary timing instrumentation was removed before the final clean validation.

Final clean round-three validation passed: workspace build, typecheck and 386 tests
(33 protocol, 141 hub, 73 agentd, 139 CLI). This run used the unchanged hook budgets and
serial CLI test-file scheduling, including the repeated-SessionStart regression. Temporary
tracing was absent. Artifact qualification remains the independent QA gate.

## Final release qualification

The final rebuilt 0.3.0 candidate passed the complete `pnpm release:check` gate:
frozen install, zero known dependency vulnerabilities, synchronized versions/catalogs,
workspace build/typecheck, 386 workspace tests, 44 script tests, fresh export integrity,
both clean-PATH plugin smokes, and the expanded exported-plugin E2E. Independent QA also
passed those artifact checks against the exact packaged candidate. Earlier candidate
failures were corrected, not waived; see [QA](qa.md) for the negative control and history.

Correctness and security review approved the final change. The bounded external reviewer
returned no verdict within its time budget and was skipped. Source/credential scans passed;
two artifact findings were verified as public license checksums. Handoff headers and vault
links validated. The user subsequently authorized publication; [published verification](publication.md)
records public downloads, native CLI installation and CI results. Production hub, daemon,
user profiles and feedback observer were not changed.
