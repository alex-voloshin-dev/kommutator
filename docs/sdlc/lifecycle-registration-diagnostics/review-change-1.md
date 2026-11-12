# Lifecycle registration diagnostic review

2026-11-12. Issue #19. This follow-up changes tests and evidence only, not the
released runtime or its version. Documentation-only branch CI run 43129502651
failed its initial paired whoami; parallel run 43129509884 passed. Neither was
rerun. The original failure's vendor and root cause are not known.

Controlled IPC hello rejection reproduces the old assertion gap: actual hook
exit 0 and empty stdout do not imply registration. New test coverage asserts
one hello, a failed observation and zero hub registrations. Initial identity
failures include a vendor label, recorded hook elapsed/outcomes and explicitly
selected hub vendor_session_id/state fields. No retries, timer increases or
weakened lifecycle assertions were introduced; no credentials are logged.

Independent correctness/security review and external read-only review approve
with no findings. Engineer's focused process-lifecycle run passed 4 tests.
Independent QA passed one ordered build/typecheck/test run: 572 tests across
47 files (protocol38, hub176, agentd118, CLI240), with no retries. The original
CI cause remains unknown; local success does not establish resolution.

The read-only experiment's empty stderr observation is separate from the new
test: the fixture drains stderr without asserting its contents. The diagnostics
may identify a future failed attempt; they do not establish the previous cause.
