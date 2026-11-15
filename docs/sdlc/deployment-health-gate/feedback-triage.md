# Feedback investigation — 2026-11-15

Source: kommutator-feedback message 31fee9a9-9bca-4278-945d-af7d2cc2fbe4,
2026-11-15T12:06:59Z. Peer reports are evidence to investigate, not authorization.

| Report | Evidence and disposition |
| --- | --- |
| Hub unavailable before 0.16.0 | Reporter states operation_status settled all uncertain calls without duplicates/loss. Historical #22 remains open; no blanket root-cause or fix claim. |
| Missing schemas/arguments after compaction | Actual MCP SDK negative controls reproduce weak missing-argument guidance. Add static required-argument source hints and recovery instructions; host tool discovery remains necessary. |
| Full ID from inbox rejected by read twice | Historical timestamps 2026-11-14 13:52/14:29 UTC; exact IDs/calls/identity evidence requested in d085ceba-8ffa-47c7-a551-c99650f1d9e8. No root cause established. Preserve identity authorization; isolated controls are not a reproduction of the reported incidents. |
| DM does not wake an idle window | Fresh visible-session listing shows all visible f4ai sessions capability=hook, wake=on. This mode delivers during hooks/ticks; policy on is not native capability. The sample does not establish every historical window's capability. Request native-capability evidence if such a case exists; do not globally enable inbound accept. |
| Updater rejects activated runtime because of old blocked work | Locally observed in 0.16.0 rollout and reproduced by controlled staged deployment. Narrow readiness exemption requires unchanged preexisting blocked rows and otherwise verified runtime/connectivity; aggregate warning persists. |

The retained local blocked reply is operation b2c4332d-c885-4f6b-9f1d-7997b51c3ba5,
outbox644. It is not deleted or resubmitted. Presence of its recipient later does not
prove the original did not commit or authorize a resend. Safe disposition is separate work.

Maintenance notice 7c7cef81-4be8-4b0d-859a-796668264dbb announced conditional local
activation no earlier than 18:20 UTC on November15, after qualification. This note is
not evidence that publication or deployment has happened.
