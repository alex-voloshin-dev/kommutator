# Feedback triage — 2026-11-24

## Scope and assumptions

The user requested feedback processing before publishing the prepared 0.16.2 release.
Substantive feedback exists. Production remains 0.16.1; draft PR #36 is still unmerged,
and 0.16.2 has no public tag/release. This branch starts from its prepared head 5933e79.
No cutover or publication is claimed. New code requires independent review, QA and gates.

## Findings and disposition

| Feedback | Assessment | Action |
| --- | --- | --- |
| #454, 251e330b-d013-4958-ad56-801080617466 | Hosted watch launcher writes private directories even when a ready cache exists; direct watch hides local permission errors. Sandbox socket access is a separate constraint. | Reproduce isolated read-only execution; repair only validated paths and safe diagnostics. Do not bypass sandbox permissions. |
| #455, 8d7868bb-b07d-48e6-9556-65d853ca6fb4 | `Projects.key` retains negative remote lookups for daemon lifetime. A subsequently initialized repository can remain on a basename project. | Reproduce fresh-session discovery and retry negative lookup without migrating existing owners or weakening context checks. #456 withdrew migration assistance, not the bug. |
| #457–459, #462–464, #466 | Three reported sends remain unknown after reconnect and recipients report absence. Remote daemon 0.16.0; not evidence of a regression in unpublished 0.16.2. | Existing candidate repairs a reproduced pre-admission hub-dependent lookup. Historical attribution still requires sender-side observation/outbox correlation; no blind resend or queue deletion. |
| #460, eb94e7e5-3ab3-4c6c-8097-2598ec7d92b8 and GM follow-ups | Sessions report capability `hook`; `wake=on` does not establish native interruption of ScheduleWakeup. | Sent explanation with per-session policy boundaries; improve setup clarity without globally enabling inbound acceptance. Native wake remains a live gate. |
| #453, 0f8ef042-e571-41ce-b065-e06664b0a0ce | Separate f4ai-think host successfully listed/read messages after NAT/IP Helper recovery. | Record allowed-client application evidence; do not claim outside-subnet deny acceptance. |

## Corrected incident evidence

GM initially reported four unknown sends, corrected to three. Final recipient checks report
12/12 absent for c2530d26-345e-43ad-8d8a-6ad54a4f8694 and both recipients absent for
68b3dd37-e305-4748-b6bb-b05fb86b4a67. The third reported operation is
f336e428-7896-4633-bdc4-54f0b650ce6c. Architect also reports unknown
6c966df2-a42d-446a-8ae9-eb7b96f37d1e. These are peer observations, not our inspection
of their daemon database. Operation UUID is not the hub replay key. Missing retained
observations and later recipient absence do not prove a globally safe retry.

## Current local observation

MCP and shared daemon 0.16.1, contract 4, current caller active and hub connected.
Aggregate health degraded solely for the retained old blocked outbox 644. No changes to
that operation, live databases, service versions or remote daemon were made for this triage.
Early SessionStart/UserPromptSubmit failures and later successful hooks both remain visible;
later successes do not explain the early failures.

## Communication

Wake explanation confirmed routed: 84fc2056-abe3-4dd4-a9c5-ea70a2df3753.
Offline-send/release-scope triage confirmed routed: 38df0592-4d76-45ff-bfdb-787eeb12b947.
No read receipts or native wake are inferred from routing confirmation. No maintenance
window was announced. A fresh warning at least 15 minutes before cutover remains required.
