---
type: review
target: MVP_PLAN steps 3–4
iteration: 2
verdict: approve
findings: []
date: '2026-10-25'
status: final
feature: m1-daemon-shim
---

Independent correctness and security reviewers approved the integrated implementation.
Each independently ran 24 core and 5 IPC tests; Unix socket tests required local-socket
permission after sandbox EPERM. Correctness additionally reproduced three lifecycle
scenarios against the freshly built production core and real conformance hub: first-offline
revival without prior launch facts, pending reincarnation followed by death/lost ACK/restart,
and multiple pre-registration revivals with a lost initial ACK and stale gone replay.

Resolved findings: a bound shim could switch to a different session after its original
ended; revival before the first registration ACK omitted reincarnation; gone could carry
the previous epoch while reincarnation was pending; a new launch could inherit old accept
and credentials. Six regression tests cover these boundaries. IPC now returns correlated
bounded -32011 errors for oversized results and distinguishes parse/envelope errors, with
five transport regressions. No blocker, major or remaining minor finding was reported.

Root build and typecheck passed on Node 24.19.0 / pnpm 10.18.0. The full workspace suite
passed 233 tests. QA then added one test, with no production edits, for a valid cold
SessionStart returning within 200 ms and leaving the detached daemon alive; the entire CLI
suite passed 29 tests. Latest coverage totals **234**: protocol 30, hub 128, agentd 47,
CLI 29. This final CLI rerun is distinct from the earlier full-workspace run.

QA verified acceptance coverage and process cleanup. The process tests use real MCP/daemon
processes and fake vendor endpoints; they do not claim live Claude or M1 E2E. External CLI
review was skipped under the installed Codex adapter's optional-pass rule. Repository policy
overrode worktree/Git defaults; this checkout remains without Git.
