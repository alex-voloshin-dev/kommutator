---
type: release
feature: session-delivery-reliability
status: approved
version: 0.10.0
changelog:
  - "Added: explicit authorized topic watch with an independent observation cursor."
  - "Added: read-only Codex caller status and bounded private hook outcome diagnostics."
  - "Fixed: defer Codex registration when process ownership cannot be verified."
  - "Fixed: distinguish hub transport failures from local daemon shutdown without misleading queue claims."
breaking: []
---

# v0.10.0

`kom watch --session <hub-session-id> --topic <name>` observes one existing local session's
joined topic. It emits eligible headers as untrusted JSON lines, includes already-read
messages, and never marks receipts. Default behavior tails future messages; use
`--since-seq` to replay or resume. No cursor file or exactly-once guarantee is provided.
DND/gone pauses; topic membership is revalidated on the next active poll. Empty polls
produce no stdout and consume no model turns by themselves.

Codex caller diagnostics now distinguish a healthy hub from an unavailable registration.
Unknown process birth defers registration without changing existing state. Hub transport
failures and local daemon shutdown have distinct bounded IPC errors. Hooks retain the
fail-open deadline while recording limited private diagnostic evidence; absent evidence
is not success.

Update both hub and local daemon to use watch. No database migration or runtime contract
bump is required. Older daemon caller diagnostics are explicitly unverified. Bundled
Claude uses its actual installed `bin/manage` path; hosted Codex uses `bin/launch manage`.
No automatic vendor monitor configuration is installed.

## Validation

Independent correctness, security, external review and QA approved. The ordered workspace
build/typecheck/test passed 487 tests, including real subprocess checks for stalled IPC,
hook output followed by failed acknowledgement, and watch silence without daemon startup.
Release qualification and deployment results are recorded in the deployment artifact.

## Not validated

Real Claude Monitor execution and Codex native idle wake remain unverified. Vendor
Monitor deadlines require explicit renewal; this is not indefinite unattended monitoring.
Day-long, Windows reboot and physical-subnet gates remain open. The historical MCP shim
exit remains unexplained; the reproduced missing-birth defect is a separate finding.
