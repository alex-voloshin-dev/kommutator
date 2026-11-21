# Claude offline tracked admission

## Assumptions and scope

The maintainer requested investigation of two Claude sends returning unknown during a
reported hub outage. This small change removes a reproduced pre-admission hub dependency
for an already registered Claude owner. It does not establish the historical sends' cause
or result, repair hub availability, replay those operations, or make missing/retired-owner
registration recovery work offline. The direct implementation request is the plan; no
separate plan artifact was supplied. Artifact discovery selected this feature directory.
Stack detection reported JavaScript at the root manifest; the changed package is TypeScript,
so both packs and the repository's ordered build/typecheck/test gate were used.

## Reproduction

`ClaudePluginClient.call` previously ran `whoami` before every non-lookup request. Agentd
implements `whoami` with a hub `topic.list` after flush. Even when the same live owner is
registered and the daemon can durably queue tracked work, an offline hub rejects this
preflight before `operation.submit` is called. MCP already allocates the operation UUID,
so the outer response is unknown without an admitted observation in this controlled case.
That mechanism is compatible with the feedback but does not prove the historical sequence.

Two new tests use the real MCP SDK/server, Claude wrapper, DaemonCore, in-memory SQLite
and the hub conformance harness with a fault-injected disconnected transport. Both send
and explicit ack fail on the original wrapper: `/tmp/kom-offline-baseline-test.log`
(2 failures). The baseline build passed first. Dependencies are independently installed
in this worktree with the frozen lockfile, Node 26.13.0 and pnpm 12.18.0.

## Change and boundaries

DESIGN section 19 was updated before implementation. A tracked submit now preflights
its existing UUID using local `operation.status`. This invokes the daemon's immutable
tracked-owner and binding checks, without the extra remote topic lookup. The result is
not a resend instruction and is not used as evidence of non-admission. The subsequent
single `operation.submit` still owns atomic admission, replay keys and durable outcomes.
No executable schema, runtime contract, hub behavior or hook timer changed.

The existing `-32020` pre-dispatch recovery remains: revalidate the committed generation,
replay current hook authority, revalidate again and open a fresh shim. This recovery still
uses hook `whoami`, so it may fail offline. Direct operation lookup never enters recovery.
Malformed IDs, unsupported lookups and transport errors do not trigger a mutation fallback.
Once submit is dispatched, an error including `-32020` never retries it. All generation
checks before dispatch and after the result remain.

## Tests and validation

- Real MCP/daemon send and ack queue offline, preserve exact outbox work during lookup,
  and settle the original operation once after reconnection.
- Unsupported, invalid-parameter, hub-unavailable and unclassified preflight errors stop
  before submit and do not trigger registration recovery.
- A malformed UUID is rejected by the real daemon without queue admission.
- Conversation switches during preflight/recovery fence dispatch; a switch after submit
  returns uncertainty without repeating the mutation.
- Retired-peer preflight recovery opens a fresh shim; a subsequent submit error is not retried.
- Existing `claude-resume.test.ts` and `mcp-operations.test.ts` remain unchanged.

Ordered full build and typecheck passed. The full test run stopped in the hub package:
protocol 41 passed; hub 206 passed / 3 failed. The failures were timeouts in WAL backup,
schema-5 rollback and schema-6 migration setup. Agentd and CLI full suites were not reached.
Log: `/tmp/kom-offline-candidate-test.log`. No timeout was increased and no historical or
current timeout is explained by a later successful run. Focused results are recorded below
when complete; independent review/QA and release qualification remain coordinator gates.

Focused follow-up passed 36/36 tests across `claude-offline.test.ts` (11),
`claude-resume.test.ts` (12) and `mcp-operations.test.ts` (13):
`/tmp/kom-offline-focused.log`. This does not supersede the failed full gate above.
