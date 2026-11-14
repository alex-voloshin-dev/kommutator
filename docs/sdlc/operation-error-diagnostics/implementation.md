# Blocked operation diagnostics implementation

## Assumptions and scope

The user's direct maintenance request is the plan for this small change: expose safe,
useful rejection evidence for tracked send/ack without weakening identity or replay.
The change does not dispose of blocked commands, automatically join topics, retry work,
add admission logging, or resolve hub availability. No production services or databases
were modified. Relevant prior decisions: [[../../knowledge/protocol-and-boundaries]],
[[../../knowledge/codex-root-identity]], [[../../knowledge/operability-evidence]].

## Reproduction and implementation

The new conformance-hub test submitted to an unjoined topic on unchanged 0.15.1 code.
It failed with the hub membership RpcError instead of returning the already durable
blocked observation. `/tmp/kom-operation-errors-baseline.log` records that negative
control (one failure, 39 tests skipped). The baseline build passed first.

DESIGN §19 was updated before implementation. After own-operation settlement and the
existing owner recheck, tracked submit now returns the retained blocked observation
before considering its cached error. MCP validates its shape and correlation, preserves
outcome `blocked`, marks initial send/ack as a tool error, and adds fixed no-resend guidance.
Lookup remains a successful diagnostic. Unavailable/invalid observations remain unknown.

Lookup derives an optional finite reason from exact RPC code/message pairs in the linked
outbox row: topic membership required, recipient not found, reply parent unavailable,
or missing project registration. Prefixes, mismatched codes and arbitrary remote text
are not reflected. The observation's stored JSON still contains only category/code;
there is no database migration or retrospective observation adoption. Unknown/foreign
IDs stay indistinguishable. A rejection after a lost commit retains the original outbox
command and replay key; the rejection is not evidence of non-commit.

## Compatibility and limits

Shipped 0.15.1 IPC parses result as unknown and MCP forwards the result object rather
than validating OperationSubmitResult or OperationStatus. It can forward the new fields,
but gets neither the new tool-error flag nor guidance until its own MCP code is updated.
Third-party users of the older strict protocol result schemas must update those schemas.
The runtime contract and storage format are unchanged. Legacy hub messages not matching
the exact allowlist retain category/code without an invented reason.

## Validation

Independent frozen dependencies, Node 26.13.0 and pnpm 12.18.0; no shared mutable
node_modules. First ordered build/typecheck/full suite passed 739 tests (41 protocol,
196 hub, 209 daemon, 293 CLI). The final ordered gate passed 740 tests (41 protocol, 196 hub, 210 daemon, 293 CLI),
including one additional lost-commit followed by rejection test. Tests cover initial and
lookup agreement, other-owner privacy, exact allowlist, arbitrary-text suppression,
stored-error compatibility, continuous refresh preservation, all three MCP tool paths,
malformed observations and wrong correlation. No lint script exists.

The first temporary old-MCP compatibility probe used a non-existent package filter;
it ran no tests and is invalid evidence. The corrected probe passed one test using exact `v0.15.1:packages/cli/src/mcp.ts`
with candidate dependencies and a synthetic blocked response. It confirms old MCP source
forwards the reason and does not set isError. This is not a full old installed-runtime or
mixed-process acceptance test. Temporary probe files were removed. A preparatory check
also found esbuild unavailable as a direct root dependency; it ran no compatibility test. Packaging, independent review/QA and release remain
the parent workflow's gates.


Validation logs:
- `/tmp/kom-operation-errors-baseline-build.log`
- `/tmp/kom-operation-errors-baseline.log`
- `/tmp/kom-operation-errors-build-final.log`
- `/tmp/kom-operation-errors-typecheck-final.log`
- `/tmp/kom-operation-errors-test-final.log`
- `/tmp/kom-operation-errors-old-mcp-valid.log`

`git diff --check` passed. The root coordinator owns incident/availability evidence and
roadmap additions in this shared worktree; they are separate from this implementation.
