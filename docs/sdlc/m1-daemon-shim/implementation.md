# M1 steps 3–4 implementation checkpoint

Implementation date: 2026-10-25. Scope: daemon, IPC, durable replay, wake scheduling,
MCP shim, hooks and local commands under [MVP_PLAN](../../MVP_PLAN.md) steps 3–4.
The user approved explicit per-session `crossSessionInbound: accept` for bypass M1
sessions. The companion launch marker `KOM_CLAUDE_INBOUND_POLICY=accept` declares that
policy to kommutator; it neither changes nor independently verifies vendor settings.

## Implemented

- [Daemon core](../../../packages/agentd/src/core.ts) binds each connection, stamps identity
  and authorship, resolves pending registration before dependent writes, and replays durable
  operations through the [registry](../../../packages/agentd/src/registry.ts). Stable keys
  survive disconnect/restart; replay older than seven days is blocked and reported.
- [IPC](../../../packages/agentd/src/ipc.ts) uses a restricted Unix socket as the singleton
  lock, including simultaneous startup and stale-socket recovery. [Daemon lifecycle](../../../packages/agentd/src/daemon.ts)
  manages restricted state/log files, process-birth checks, idle exit and shutdown.
- [Hub link](../../../packages/agentd/src/hub-link.ts) authenticates with Bearer, correlates
  requests, reconnects and resyncs deliveries after hello and lifecycle replay. The local
  per-sequence ledger prevents repeated wake without advancing across unfinished work.
- [Wake scheduler](../../../packages/agentd/src/wake.ts) coalesces a 30-second interval
  into one trailing wake and rechecks unread/DND state. Pending work survives restart.
  The [Claude adapter](../../../packages/agentd/src/adapters/claude.ts) emits the observed
  envelope, preserves peer etiquette/IDs, redacts token echoes, and treats silence as written.
- [MCP](../../../packages/cli/src/mcp.ts) exposes 14 tools through SDK stdio. Claude uses
  `CLAUDE_CODE_SESSION_ID`; two sessions sharing a cwd remain distinct, and ambiguous
  fallback is an error. Model tools cannot select authorship or force human wake.
- [Hooks](../../../packages/cli/src/hooks.ts) normalize optional launch facts, fetch oldest
  unread headers, pack at most five, flush stdout before acknowledging only shown headers,
  and enforce one Stop continuation per user-prompt cycle. The entrypoint enforces the
  fail-open deadline, including missing/unfinished stdin and a cold daemon.
- [Commands](../../../packages/cli/src/commands.ts) implement daemon run/stop/restart,
  status, send, DND, hub run/backup and paths. Human origin requires stdin TTY.
  [Init](../../../packages/cli/src/init.ts) writes private config and idempotently merges
  hooks; `--no-hooks` avoids duplication when using the plugin. It never enables accept.

Outbox and delivery coordination are grouped in core/registry rather than separate
outbox/deliver modules. Hub schema remains 5; agentd introduces its own state schema 1.
Protocol adds CLI hello, caller project key, host-local inbound policy and daemon-owned
capability refresh. [DESIGN §19](../../DESIGN.md#19-implementation-decisions-and-open-questions)
records these choices and the lifecycle/receipt boundaries.

## Validation and review

On Node **24.19.0** / pnpm **10.18.0**, `pnpm -r build`, `pnpm -r typecheck` and
`pnpm -r test` passed (233 tests). QA then added one process test without changing
production code and reran the complete CLI suite: 29 passed. The latest package results
total **234**: protocol 30, hub 128, agentd 47, CLI 29. Local Unix/TCP socket suites ran
with permission to create temporary test endpoints. No lint script is configured.

Coverage includes protocol/hub capability refresh, adapter framing and policy, ordered
offline replay, lost ACK recovery, binding, resync, cooldown, Stop, SDK tools, hook timing
and private init. The additional valid cold SessionStart test measured process exit under
200 ms and observed the detached daemon still alive afterwards; cleanup assertions passed.

The process QA test starts two actual built `kom mcp` processes against a real local hub
and fake vendor sockets. Fresh and stale Unix socket cases each produce one daemon,
distinct same-cwd identities and an explicit ambiguous-third-shim error. After the first
shim exits, the same daemon PID serves the second. This is not a live Claude E2E run.

Independent correctness/security review and QA completed with
[approve](review-implementation-2.md). Four lifecycle/identity/policy findings and the IPC
response-size/error-code gap were fixed and regression-tested. Launch opt-in cannot carry
over to a replacement process; offline gone operations resolve their correct lifecycle
epoch atomically. External CLI review was skipped under the adapter's optional-pass rule.

## Remaining gates

Step 5 adds the visible dashboard feed. Step 6 exercises the production path with two
live Claude sessions: matching hook/MCP identity, daemon survival after real Claude exit,
native idle wake and reply, project board/handoff and visible feed. Existing live vendor
evidence is in [RESULTS](../../../spikes/RESULTS.md); no new vendor run is claimed here.

`doctor`, log streaming, board revert and prune remain deferred. Linux/Codex native wake
and service installation are not validated. No Git repository, commit, push or global
vendor configuration was created or changed; Git remains step 8 after live E2E.
