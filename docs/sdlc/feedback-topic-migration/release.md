---
type: release
feature: feedback-topic-migration
status: approved
version: 0.7.0
changelog:
  - "Added: stopped-service feedback migration preserving observer identity, cursors, pending work and replay keys."
  - "Changed: use kommutator-feedback for new feedback and reject whitespace in newly created ad-hoc topic names."
breaking:
  - "New ad-hoc topic names cannot contain whitespace; use hyphens between words. Existing topics remain accessible."
  - "Existing feedback observers require the documented migration before switching the default topic."
---

# v0.7.0

The canonical feedback topic is `kommutator-feedback`. The old `kommutator feedback`
topic remains available as a historical archive; it is not an alias. New feedback belongs
in the canonical topic. Use hyphens between words in topic names.

The hub rejects whitespace, including Unicode whitespace, when creating a new ad-hoc
topic. Existing names remain accessible so historical messages, memberships and pending
replies keep working.

An explicit operator migration preserves the observer session and mailbox cursor,
unfinished feedback jobs, report identifiers and replay keys. Private backups, service
locks and restart fences protect interrupted migrations. See
[the migration instructions](../../FEEDBACK_TOPIC_MIGRATION.md).

This release follows v0.6.0; it preserves topic discovery and registration-independent
status diagnostics from that release. The pre-1.0 minor increment reflects the new
topic-creation restriction and required migration for existing feedback observers.

## Validation

`pnpm release:check` passed on Linux x64 / Node 24: frozen dependency installation,
high-severity dependency audit, version/catalog consistency, workspace build/typecheck,
403 workspace tests and 88 operator/script checks (including all 11 migration cases).
Export integrity, clean-environment Claude/Codex plugin setup and synthetic cross-vendor
messaging/recovery checks also passed. Review round 2 approved the standalone migration
correction; the develop gate returned `proceed`.

Source and full-history secret scans found no leaks; comparison against actual local
credentials found no matches in source or the final exported artifact. The artifact scanner's
two findings are verified SHA-256 values for the public `path-key` dependency license.

Automated process and artifact tests use synthetic clients. Physical LAN subnet isolation,
Windows reboot/logon, day-long use and additional vendor versions are not qualified by
this release's tests.
