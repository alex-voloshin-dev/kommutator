# Rejected-hook observation contract correction

2026-11-12. Branch CI run 43135901281 failed the lifecycle rejection test because
it required a final `failed` diagnostic but read `attempted`. PR run 43135906663
and tag run 43135917242 at the same candidate commit passed. No failed job was
rerun to obtain a passing result.

The production hook explicitly treats observation storage as best effort. Its
unchanged 140 ms entrypoint deadline can interrupt the final asynchronous flush.
An attempted observation neither proves registration nor proves rejection; its
absence or incompleteness remains unknown. The test incorrectly required final
persistence from a deadline-bounded process.

The real-process regression now proves the relevant behavior with the controlled
IPC rejection, exactly one `ipc.hello` and no subsequent request, exit 0/empty
stdout, zero hub registrations and no false `success` observation. It does not
accept `attempted` as evidence of rejection. A separate deterministic test invokes
the real hook to completion with a controlled rejected IPC call, then reads the
real observation store and requires the final `failed` record. This preserves
final-outcome coverage without depending on completing filesystem writes within
the process deadline. Runtime timers, persistence, identity and replay behavior
are unchanged.

This corrects the new diagnostic test's contract. It does not establish the cause
of the earlier missing-registration report (#19) or all latency outliers (#9).
