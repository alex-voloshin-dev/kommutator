# Independent QA — 0.12.3

2026-11-12. Added three cases covering uncoded EOF/malformed errors and the
shared shutdown/confirmation deadline. Engineer follow-up review approved these
additions and the evidence corrections. No production implementation was changed by QA.

One complete `pnpm release:check` passed with Node 26.13.0 and pnpm 12.18.0:
frozen installation, high-severity dependency audit, hosted catalog/version checks,
ordered workspace build/typecheck/test (571 tests: protocol38, hub176, agentd118,
CLI239), 134 script tests, export integrity, clean-PATH Claude/Codex setup probes
and synthetic exported-client E2E. No failing qualification was retried.
The 12 CLI hook measurements were 112.995–184.428 ms in this run; the separate
18-sample diagnostic still contains an untraced 277.723 ms outlier. #9 stays open.

Source tree and Git history secret scans passed. Export scanning found two
generic-api-key matches in runtime release manifests; both were payload SHA-256
values. Allowed manifest keys and all 189 payload hashes per vendor were verified.

These tests do not establish real model conversations, native wake, other platforms,
physical-subnet behavior, Windows reboot or day-long reliability. Socket-connect
stall is not separately injected; cancellation of stalled handshake/replies is covered.
