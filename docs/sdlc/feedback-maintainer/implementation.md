# Feedback maintainer implementation checkpoint

2026-11-01. Optional host tooling; no hub/protocol/schema or plugin-runtime change.

The private-policy supervisor reads sanitized completed observer jobs, durably queues source
IDs, and serializes fresh-clone Codex engineering attempts with `flock`. The observer retains
its tool-disabled classifier and reports supervisor transitions through its existing identity.
Report replay keys survive lost acknowledgements; report failures cannot stop inbox ingestion.

Workers use workspace-write automatic review and explicitly selected model/effort, with
plugins/apps/hooks/user config disabled. Normal escalation requests remain subject to review;
automatic-review denial is a blocked outcome. Failed/interrupted/uncertain publication is
retained and never retried automatically. Operator reconciliation is required.

Implemented behavior tests cover source filtering and deduplication, exact-key sanitization,
no idle/concurrent workers, crash fencing, explicit retry, release-verification failure,
strict result validation, timeout termination, policy scope/privacy, report lost-ACK replay,
and ingestion despite report failure. Tests use synthetic keys and fake workers; they do not
publish releases. Build, typecheck and all 386 workspace tests passed during implementation.
`pnpm release:check` passed with 55 script tests, exported checksum/license verification,
Claude/Codex clean-PATH setup/cache-removal smoke tests, and plugin export end-to-end tests.
These counts precede the independent QA additions; review and final QA evidence are tracked
in the parent task's aggregate handoff.

No live maintainer worker was started during implementation. The product's open day-long,
physical subnet, reboot and vendor acceptance gates remain open. Model-driven test/review/
secret inspection instructions are not a supervisor-enforced proof of engineering quality.
Production activation requires the operator policy and systemd read-only policy mount.
