# Unread feedback investigation

2026-11-11. Report: kommutator-feedback message b03b8e8a-45bf-46da-960c-444d4a323ccf.
A client on 0.11.0 reported repeated unread headers around sequences 80–129 after ack.

## Findings

No replay defect was reproduced with correct message IDs and the same recipient identity.
Inbox reads hub SQLite directly. Receipt updates are monotonic unread → read, and hub/daemon
receipt paths are unchanged from v0.11.0. Read-only inspection of the reporter's mailbox
found 48 unread deliveries and other successfully read deliveries; this confirms pending
receipts but cannot establish the earlier ack arguments or caller identity.

A 130-message test exercises MCP and production daemon/hub handlers using in-memory
transports. It constructs the exact final fifty-message page (seq 80–129), verifies repeated
listing leaves it unread, and confirms correct same-recipient acknowledgement drains it.
Reading the next message also clears it. Sequence strings and another recipient's IDs return
`ok:true` while leaving the mailbox unchanged. That diagnostic ambiguity is proven; its
causal connection to this report is not. Message IDs are bounded opaque strings by contract;
adding blanket UUID validation would be an unjustified compatibility change.

## Decision

Retain regression coverage; do not ship a speculative receipt fix. Ask the reporter for
exact ack arguments/result and before/after caller identity. Clearer acknowledgement results
(matched/changed/unmatched counts) merit separate protocol/UX work, not a claim to have fixed
this report. No production receipts were modified for diagnosis.

## Review and evidence limits

Internal correctness/contract review: approve, no findings. Build and typecheck passed;
focused conformance suite: 4 passed. This is handler-level evidence, not live vendor binding,
network transport, reconnect, or a reproduction on the reporter's machine.

Final external review: approve, no findings. QA full workspace suite: 521 passed
(protocol35, hub175, agentd102, CLI209). No runtime changes were made. Review decision:
proceed at iteration1 for the test-only investigation.
