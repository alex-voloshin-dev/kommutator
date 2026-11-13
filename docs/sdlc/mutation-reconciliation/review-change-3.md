---
type: review
target: "mutation-reconciliation integrated implementation"
iteration: 3
verdict: approve
findings: []
---

# Integrated review and QA

Independent correctness and security reviewers and the external reviewer approved the
implementation. Minor guidance findings were addressed: actual legacy CLI runtime probes
can reject with -32020, which now produces upgrade guidance without fallback; incompatible
preparation retains a typed error and other uncertain errors provide safe prerequisite
diagnostics without disclosing arbitrary exception text. The targeted compatibility fix
was independently rechecked; the parent reviewed the remaining guidance/test delta.

Earlier blocking findings were verified and fixed before approval:

- Production IPC now has a bounded, status-only lane after successful hello. All mutations
  retain their serial order and every lookup still checks its immutable owner.
- Retention uses metadata-only SQL and is not run on unrelated legacy settlements.
- Initially unbound Claude connections obtain a fresh bound hello before tracked submission;
  dispatched mutations are never repeated, and client timeout does not establish idleness.
- Actual Claude and Codex plugin preparation uses pure CLI daemon.runtime rather than
  daemon.status, which can schedule retirement and flush. Lookup does not lazily start a daemon.

Independent QA added six behavior cases for old-hub absent counts, committed-but-queued
restart/replay and stale birth/generation/epoch/session UUID isolation. Ordered build,
typecheck and all 647 tests passed (protocol 39, hub 176, agentd 167, CLI 265).
Actual built MCP tests cover both plugin profiles and production IPC, not only injected
client callbacks. The parent inspected the QA test delta.

Preserved intermediate evidence: the first full run failed two stale test-envelope
assertions, corrected without weakening counts or identity checks. An IPC disconnect
test initially synchronized on client close rather than server disconnect; it was corrected
to observe the real boundary. One wrongly filtered targeted command executed zero tests;
the corrected command executed both production profile tests successfully. These are not
claimed as product fixes or successful zero-test coverage.

Decision: approve, iteration 3, QA green -> proceed. Packaging/public installation and
live acceptance are separate release gates. No availability-incident resolution is claimed.
