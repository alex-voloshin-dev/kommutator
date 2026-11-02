# Feedback topic migration implementation

The canonical feedback topic is `kommutator-feedback`. Newly created ad-hoc topics reject
whitespace at the hub boundary, including Unicode whitespace. Existing names remain
joinable, readable and leaveable. The general wire schema remains compatible with history;
the separate creation schema and MCP description state the new naming contract.

The optional operator migration runs with both observer and maintainer locks. It requires
matching original hub/configuration and an existing observer identity, rejects running
engineering jobs, and backs up both SQLite journals with `VACUUM INTO` plus the private policy.
It joins the new topic using the existing observer session, captures bounded inbox pages and
reads missing bodies. Existing new-only ignored rows become pending; captured old rows form
an explicit legacy-job fence. The observer retains its host/session, cursor and registration
replay payload. Historical publication targets, job IDs and replay keys remain unchanged.
New maintainer transitions publish to the new topic even when replying to a historical parent.

Both runtimes refuse incomplete-migration metadata. Readiness follows durable identity and
policy changes. Rerunning after readiness only completes the marker and does not reclassify
new traffic. Services restart explicitly; no production operation is performed by tests.
See [the operator runbook](../../FEEDBACK_TOPIC_MIGRATION.md).

Integrated on upstream v0.6.0 (`d12064f`), preserving its topic discovery, created/joined
results, registration-independent status and stale-daemon recovery behavior. Version 0.7.0
was synchronized before final compilation at the release owner's request. The hosted artifact
catalog and release packaging remain the release owner's responsibility.

Validation evidence is recorded in the accompanying review and QA handoffs. Live migration,
monitoring verification, packaging qualification and publication belong to the operator/release
stage. Existing long-duration, external-subnet and Windows reboot gates remain open.

Review round 2 added explicit observer-only migration for independently installed observers.
It requires no maintainer authorization or skills, refuses partial maintainer evidence, preserves
the same recovery contracts, and syncs the SQLite backup directory before recording its marker.
