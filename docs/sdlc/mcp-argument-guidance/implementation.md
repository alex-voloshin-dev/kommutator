---
type: implementation
feature: mcp-argument-guidance
status: implemented
---

# MCP argument guidance and inbox/read investigation

## Scope and assumptions

The direct maintenance request is the plan. This change improves static guidance for
invalid `read.id`, board `topic` and board `key` arguments. It does not reconstruct a
host's discarded deferred-tool schemas, repair identity, join topics, expand IDs or
resubmit operations. `board_get` keeps its optional key; a new `board_put` still permits
an explicitly selected new key. Existing opaque 1–64 character message IDs remain valid.

Knowledge inputs: `docs/knowledge/protocol-and-boundaries.md` preserves session-pinned
inbox authority and receipts; `codex-root-identity.md` forbids environment/cwd identity
fallback. DESIGN §19 records the unchanged boundaries before implementation.

## Reproduction and implementation

Actual MCP SDK/InMemoryTransport calls against baseline b7f4682 produced generic Zod
errors rather than actionable sources for missing, wrong-type, empty and oversized
arguments. The new baseline tests failed 11 cases, while 17 existing/control cases
passed. Log: `/tmp/kom-argument-baseline-test.log`. An initial command used an incorrect
package filter and ran no tests; it is not counted as evidence.

The MCP-local property schemas now retain their original validators and attach bounded,
static error text and discoverable descriptions. `read.id` points to a complete ID from
the current session's inbox; board topic points to whoami/list_topics without adding a
send-address prefix; existing board keys come from board_get. This runs during SDK
prevalidation, before resolving a client or issuing IPC. Tests retain strict unknown-key
rejection, ensure no caller resolution or operation allocation on invalid arguments,
and preserve valid opaque IDs and optional key omission. The existing mutation tests
still prove that unknown outcomes do not trigger retries.

Both distributed skill templates explain recovering tool definitions after compaction
through the host's discovery mechanism where available. They do not promise host schema
persistence or native wake support.

## Historical inbox/read report

A deterministic hub control lists an ID, marks it read, renames its recipient, leaves
the originating topic, and reincarnates the same hub identity. The full ID remains
readable throughout, and a different recipient is still rejected. Existing conformance
and message tests also pass. No hub authorization or identity code changed.

This does not reproduce or establish the cause of the two historical remote failures.
The original exact IDs, arguments and calling identities are not available in this
worktree. A different calling identity is a valid rejection, not a diagnosis of those
reports. Their cause remains open pending original evidence or a faithful reproduction.

## Checks actually run

- Private Node 26.13.0 / pnpm 12.18.0; isolated frozen-lockfile installation.
- Ordered workspace build then typecheck: passed.
- Focused MCP tests (`mcp.test.ts`, `mcp-operations.test.ts`): 42 passed.
- Focused hub controls (`messages.test.ts`, `conformance.test.ts`): 69 passed.
- `git diff --check`: passed.

Final logs: `/tmp/kom-argument-build.log`, `/tmp/kom-argument-types.log`,
`/tmp/kom-argument-focused.log`, `/tmp/kom-argument-hub-controls.log`.
The full workspace suite, independent review/QA and packaging are pending integration;
no release or production changes were performed by this task.
