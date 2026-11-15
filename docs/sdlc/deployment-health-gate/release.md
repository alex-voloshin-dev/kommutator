---
type: release
feature: deployment-health-gate
status: qualified
version: 0.16.1
changelog:
  - "Fixed: deployment readiness distinguishes unchanged retained blocked work from new degradation."
  - "Fixed: MCP read and board argument errors identify safe sources for required values."
breaking: []
---

# Kommutator 0.16.1

The local updater can accept verified target services while preserving an unchanged,
preexisting blocked queue and its warning. Exact version, contract4, process and hub
checks still apply. New or changed blocked work, unknown degradation and malformed
snapshots remain blocking. No queue deletion, replay or automatic retry is added.
The separately installed runner must be refreshed from the reviewed source before
this deployment behavior takes effect; installing a client plugin does not update it.

MCP read and board schemas now explain where to obtain required IDs, topics and keys.
Invalid arguments are rejected before client resolution/IPC. The hints never guess
identity, join topics or grant access. Skill guidance explains host tool discovery
after compaction. Wire schemas, runtime contract4 and database schemas5/8 are unchanged.

## Investigation boundaries

The updater failure was reproduced on baseline and the narrow candidate passed its
controlled deployment test. Actual SDK validation reproduced missing guidance.
Same-identity inbox/read controls pass across receipt, rename, topic leave and
reincarnation, but the two reported historical read failures remain unexplained.
Current visible f4ai windows report hook capability; hook-only idle polling is expected,
not native wake. No native-capability failure was reproduced. Historical availability,
registration and hook timing investigations #9/#19/#22/#25 remain open.

## Qualification and rollout

Independent correctness/API, security and external reviews approved the scoped changes.
Independent ordered build/typecheck and 807 workspace tests passed, plus 26 updater
script tests. The first full release:check passed with 807 workspace and154 script
tests, integrity, clean-PATH smoke and synthetic exported E2E. A SessionEnd delayed-import
sample measured201.473ms, above the200ms target but below the unchanged300ms temporary
limit. Artifact secret scan flagged two license-manifest SHA256 values; both were
verified against the path-key license bytes, not credentials. CI, public downloads and
deployment remain pending at this checkpoint.

## Not validated

Historical remote failure reproduction, real-model post-compaction behavior across
all vendors, native Work/idle wake, day-long use, physical subnet allow/deny and
unattended Windows reboot remain unvalidated. No remote daemon deployment is claimed.
