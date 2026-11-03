---
type: release
feature: dashboard-usability
status: approved
version: 0.8.0
changelog:
  - "Added: dashboard overview, readable session cards, topic subscribers and searchable deliveries."
  - "Added: pause/resume updates, membership polling and focus-preserving refresh."
  - "Added: explicit offline test-data cleanup with private backups and replay tombstones."
  - "Changed: current sessions are shown by default and ended history is optional."
breaking: []
---

# v0.8.0

The dashboard now makes current activity easier to scan: an overview, session cards, topic
subscriber lists, readable delivery records and structured live activity replace dense tables
and primary JSON output. Search/filter controls, expandable details, responsive light/dark
layouts and explicit empty/stale states preserve context. Pause stops visible updates; manual
Refresh works once while paused and Resume catches up. Topic membership changes also appear
without a message event. The dashboard remains authenticated and read-only; viewing it never
marks messages read.

A separate operator command removes only explicitly reviewed synthetic records. It defaults
to dry run, requires an exact fingerprint, creates a private backup and refuses unsafe reference
closures. Atomic deletion preserves content-free retired-operation keys so delayed registration,
message and board retries cannot recreate test data. It does not enable general retention or
clean other installations automatically. See [the cleanup procedure](../../CLEANUP_TEST_DATA.md).

Schema 5 upgrades additively to schema 6 at hub startup. Keep the pre-upgrade backup; schema-5
binaries cannot reopen the upgraded database. This does not change client RPC method shapes or
the daemon runtime contract (3). No dependency or framework was added.

## Validation

Independent UX, code/security and external reviews approved the change. Workspace build,
typecheck and 419 tests passed; independent focused QA passed 32 dashboard/transport and
12 cleanup tests. Chromium fixture checks exercised filters, actual topic identities/history
counts, focus/disclosure retention, pause/manual-refresh/resume, failure recovery, literal
untrusted text, membership polling, mobile reflow and readable activity.

Cleanup was rehearsed on a private online-format copy of the installed database. Exact-row
comparison proved all retained values identical; foreign-key and integrity checks passed.
The full Linux x64 release gate passed, including dependency audit, 419 workspace tests,
108 script checks, clean-environment plugin smoke and exported-client E2E. The initial exact
artifact also passed smoke/E2E. A final CSS-only control-contrast correction was independently
reviewed and rechecked in Chromium; exported payload manifests confirm only the dashboard
HTML changed. Final artifact integrity and smoke passed. Two additional local E2E attempts
hit the existing best-effort hook timing boundary (Claude registration/SessionEnd); those
failures are recorded, not counted as passes or bypassed by longer deadlines. Activation
requires successful full CI on the final release commit. Installed evidence is recorded
separately after deployment.
Synthetic browser and protocol checks do not establish native vendor wake, external subnet,
Windows reboot/logon or day-long acceptance.
