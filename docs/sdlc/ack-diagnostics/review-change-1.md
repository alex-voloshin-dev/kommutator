# Acknowledgement diagnostics review

Scope: an additive diagnostic correction for misleading `ok:true` when ack IDs match no
caller deliveries. The original replay report remains unconfirmed. Version 0.12.1 is a
patch; opaque message IDs, receipt transitions and runtime contract 3 are unchanged.

Internal correctness/integration review: approve, no remaining findings. One test expectation
was corrected during review: ack after read reports already_read=1 and marked_read=0.
Security review: approve, no findings. Caller authorization precedes all lookups; counts and
updates share BEGIN IMMEDIATE, post-commit events remain unchanged, and foreign/nonexistent
IDs are indistinguishable. External review: approve, no findings.

Ordered build and typecheck passed. Focused protocol36, hub53 and MCP/conformance15 tests
passed. Full-suite and release checks are recorded below after completion.

QA approved: all 526 workspace tests passed (protocol36, hub176, agentd102, CLI212), with
all ten hook process observations below the temporary 300 ms limit (113.052–180.317 ms).
No additional tests were needed beyond behavior and compatibility coverage.

Full Linux x64 release check passed: frozen install/audit, build/typecheck, 526 workspace
and 134 script tests, export verification, clean-PATH private setup/cache smoke, and synthetic
cross-vendor messaging/lifecycle E2E. Source diff secret scan: no findings. Artifact scan
reported only two generic-key matches in runtime/release.json; both manifests contain only
runtime metadata and 189 independently verified payload SHA-256 entries (false positives).

Prepared immutable assets:
- Linux tar SHA-256: 536bfe48bfe6661403c06f4ed9a030d15f5b915b7b10bebfe5bcaac19bf91407
- Claude ZIP SHA-256: a216760ddbfef47a74aa1444af0addfeac8c9a78400e892f1b603ff2b365c801

Review decision: proceed at iteration 1. Hosted CI, publication and actual deployment
are subsequent observations; this record does not claim them before execution.
