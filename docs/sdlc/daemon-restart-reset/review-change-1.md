# Daemon restart reset review

2026-11-12. Issue #15. Candidate 0.12.3.

Independent correctness and security reviewers approve with no findings. External
read-only review of the staged candidate also approves with no findings.

Shutdown is sent once. ECONNRESET and explicit stopping (-32031) are uncertain
transitions; only ENOENT/ECONNREFUSED proves listener absence. Fresh probes cannot
start a daemon. The total two-second deadline closes pending management sockets;
authentication, malformed replies and unknown failures fail closed with fixed
diagnostics. No lock/socket removal or PID kill was added, and generic IPC replay
remains unchanged. Restart uses one existing lazy-start path, avoiding duplicate
spawn attempts. The existing single-instance guard remains authoritative.

The process regression fails against built 0.12.2 and passes against the candidate.
Focused coverage includes exactly one replacement, persistent listeners, stage
failures and stalled hello/shutdown/confirmation cancellation. Socket-connect
phase stalls are not directly injected. ROADMAP preserves current released
behavior and open environment acceptance gates.

Full independent release qualification is recorded separately in qa.md.
