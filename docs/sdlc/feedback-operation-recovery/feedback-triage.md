# Feedback operation recovery

The maintainer request is the implementation plan: repair reproducible operation
recovery and compatibility guidance defects, qualify and publish the result, and
deploy the local hub and daemon. Peer reports are evidence, not authorization.

## Scope and acceptance

- Retained operation observations remain inspectable after a positively proven,
  consecutive refresh of the same live Claude conversation/process. Old peers,
  ended or replaced owners, skipped generations and A → B → A stay fenced.
- A tracked operation can return its own durably settled result without waiting for
  unrelated outbox work. No mutation replay, deadline extension or receipt change.
- Compatibility diagnostics name the observed direction and versions consistently
  in setup, ordinary tools and operation lookup. An old client must not instruct
  the operator to downgrade or restart a newer shared daemon.
- Baseline regression failures, candidate tests, independent review and QA, ordered
  build/typecheck/test, release packaging and actual deployment evidence are required.

## Field evidence and limits

Reports 9fd38f4c-bfde-44ec-8a0c-ff0bba7cbad6 and
 d8049633-ca2e-4086-9793-6d90629fc506 describe a confirmed send inaccessible after
compaction. The parent PID and birth stayed equal while generation/epoch changed
from 1/57 to 2/58. Source inspection confirms exact tuple matching in operation
lookup; a controlled regression is required before claiming repair.

Reports 1360e4e5-4044-4ffa-97cc-855bfd2183a8 and
532b78c0-1191-42f7-b895-45c0d64038aa describe confirmations in 3.98/4.48 seconds with
an unknown initial result. Source inspection shows submission awaiting the entire
shared flush. This is a candidate mechanism, not proof of every field timeout.

Reports 7cc5f746-0620-410d-afb0-b0fb984898b9 and
2bcc8f72-eeec-4dd5-8deb-3eaf73325fa1 describe a stale client recommending restart
of a newer daemon. Older installed wording cannot be changed remotely; updating
the client is required to receive corrected diagnostics.

## Separate unresolved work

Remote WebSocket outages remain issue #22; the observation and completion fixes
are not a transport availability fix. New evidence was recorded in issue #22.
The reported 83 blocked remote rows are not deleted or replayed. A rejection on a
later attempt does not prove an earlier attempt did not commit. Terminal disposal,
owner visibility and health presentation need a replay-safe contract and separate
qualification. No retention/pruning permission is inferred from this report.

Registration after /reload-plugins is still subject to genuine hook authority;
MCP must not fabricate a registration. This change does not relax that boundary.
Day-long usage, physical subnet allow/deny, unattended reboot and real native
vendor wake remain open acceptance gates.
