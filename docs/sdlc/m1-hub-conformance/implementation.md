# M1 steps 1–2 implementation checkpoint

Completed 2026-10-25 against the user-approved v0.2.6 contracts in
[MVP_PLAN](../../MVP_PLAN.md), [DESIGN](../../DESIGN.md) and [PROTOCOL](../../PROTOCOL.md).
This checkpoint covers the hub and conformance harness. Live native delivery remains unverified.

Later on the same date, the [2.1.310 spike run](../../../spikes/RESULTS.md) confirmed manual
native wake, MCP session IDs and Stop, but bypass/default was Held. DESIGN v0.2.7 and
MVP_PLAN rev 3 incorporate these facts; the validation below remains the steps 1–2 checkpoint.

## Implemented

- [RPC](../../../packages/hub/src/rpc.ts) validates envelopes/params, authorizes through
  domain handlers, preserves request ids on errors, suppresses notification replies and
  limits incoming/outgoing frames to 1 MiB UTF-8.
- [Sessions](../../../packages/hub/src/sessions.ts) implement register/update/reincarnate,
  stable collision suffixes, historical registration replay, heartbeat, stale gone protection
  and topic-scoped listing. Reincarnation retains membership, identity and sequence counters.
- [Routing](../../../packages/hub/src/routing.ts) derives authorship, resolves/deduplicates
  targets, checks visibility and atomically stores messages, targets, deliveries, wake and
  recipient sequences. Replay cannot create another delivery or change sender identity.
- [Inbox](../../../packages/hub/src/inbox.ts) supports unread/cursor/waking filters,
  body reads, per-recipient monotonic receipts and authorized reconnect replay. Resync does
  not mark read or allocate sequences, and current DND can suppress a stored wake.
- [Topics](../../../packages/hub/src/topics.ts) restrict joins/leaves to ad-hoc topics.
  [Boards](../../../packages/hub/src/board.ts) enforce membership, CAS, immutable replay
  ownership, advisory protection and newest-first history pagination.
- [Transport](../../../packages/hub/src/server.ts) routes pushes only to the owning host,
  replaces its previous connection and contains connection failures. WebSocket requires
  Bearer; HTTP retains Basic support for the dashboard. [API](../../../packages/hub/src/api.ts)
  serves authenticated snapshot/SSE, bounds backlog and omits internal recovery pushes.
- [Harness](../../../packages/hub/src/testing.ts), exported as `@kommutator/hub/testing`,
  uses production RPC handlers and in-memory SQLite. Fake clients connect as normalized
  hosts, collect deliveries, bind a fixture session and reconnect without real sockets.
  It is available to the daemon/shim/hook tests in subsequent steps.

The protocol result schemas, hub exports/build entries and SQL schema were updated.
Schema version is **5**; earlier files require backup/reset under the existing pre-M1 policy.
Foreign-key enforcement is enabled on every reopen. Registration journal, requested base
name, message handle snapshots and board session ownership preserve idempotence across
rename, reincarnation and process restart. These decisions are recorded in DESIGN §19.

## Validation and review

On Node **24.19.0**, pnpm **10.18.0**, from the repository root:

```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

All three passed. Tests: **164 total** — protocol 29, hub 127, agentd 8. CLI still has no
tests (`--passWithNoTests`); this is not CLI or live vendor coverage. Socket tests ran with
permission to bind local TCP/Unix sockets. No lint script is configured.

Hub suites include malformed/error boundaries, lifecycle/replay, routing/wake/receipts,
project-board isolation, CAS, conformance flow, real WebSocket/SSE integration and two
real-file SQLite reopen tests. Regression tests cover cached Basic rejection, a 128 KiB
Unicode SSE event, 65 maximum-sized escaped board versions across bounded pages and
normalized host replacement. The harness drives registration → send → deliver → inbox →
read → receipt using the production dispatcher.

Independent correctness/security reviews and a QA pass completed; final verdict is
[approve](review-implementation-3.md). Findings about browser Basic credentials, SSE
backpressure, connection replacement and oversized history responses were fixed and
regression-tested. External CLI review was skipped under the installed Codex adapter's
optional-pass rule; it is not claimed as an executed check.

Repository policy overrode the develop skill's Git/worktree default: this directory still
has no Git repository. No commit, push, deployment or vendor message was performed.

## Remaining work

Follow [M1_LIVE_RUNBOOK](../../../spikes/M1_LIVE_RUNBOOK.md) and fill
[RESULTS](../../../spikes/RESULTS.md) for live spikes 01/04/06. The runbook's shell/JS
snippets were syntax-checked; its live outcomes are not recorded yet. Its MCP environment
probe must establish both same-cwd session bindings. Detached spawn from Bash is a proxy;
repeat from the real MCP shim once it exists.

Steps 3–4 implement daemon, IPC, outbox, wake scheduling, shim and hooks using that evidence.
Step 5 implements the visible dashboard feed (the API/SSE backend is ready). Step 6 runs
the two-session native-wake E2E. The static dashboard still does not render the live feed.
Git remains step 8 after E2E, and the license remains undecided.
