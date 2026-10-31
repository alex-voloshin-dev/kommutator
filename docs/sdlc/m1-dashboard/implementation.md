# M1 step 5 dashboard checkpoint

Completed 2026-10-25. The [static dashboard](../../../packages/hub/public/index.html)
renders sessions and deliveries from the authenticated snapshot and appends all seven
public SSE event types with timestamps. The connection label is connected/reconnecting;
an SSE reopen refreshes the tables. Changes during an in-flight snapshot cause another
fetch, and failed snapshots retain the previous tables while retrying.

The feed keeps the latest 200 events with at most 1,000 code points of details per line.
Untrusted session, message and board fields use textContent. The snapshot now includes
the existing bounded Unicode preview, excluding the full message body. Authentication,
read-only HTTP behavior and the marked-read meaning are unchanged.

On Node 24.19.0 / pnpm 10.18.0, build, typecheck and **242 tests** passed: protocol 30,
hub 136, agentd 47 and CLI 29. Eight new dashboard tests cover rendering, limits,
fetch/SSE races, timeout, malformed responses and retry. The transport suite checks preview.

Actual Chromium 151.0.7922.34 connected with HTTP Basic to the production hub and
conformance harness. Registration, send, delivery/read, status update, board write and
session end appeared live without reload. After forcing SSE closed, the page showed
reconnecting and recovered a status change made during the gap through its next snapshot.
Literal malicious markup did not create HTML elements; there were no page errors.
See [browser evidence](browser-qa.json) and [screenshot](browser-qa.png).

Independent correctness/security review and QA approved the result in
[review-implementation-1.md](review-implementation-1.md). No new dependency was added.
No Git/worktree, commit or deployment was created. The next gate is the live Claude
scenario in [MVP_PLAN step 6](../../MVP_PLAN.md#step-6--end-to-end-on-the-mac).
