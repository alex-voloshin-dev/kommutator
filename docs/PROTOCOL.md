# kommutator protocol (draft)

One JSON-RPC 2.0 schema serves both hops. The zod schemas in `packages/protocol/src/schemas.ts`
are the source of truth; this file is the human-readable index.

| Hop | Transport | Framing |
|---|---|---|
| shim / hook → agentd | unix socket `~/.kommutator/agentd.sock` (named pipe on Windows later) | newline-delimited JSON |
| agentd → hub | one WebSocket, `Authorization: Bearer $KOM_KEY` | one JSON-RPC message per text frame |

`PROTOCOL_VERSION` is sent in `hello`; a mismatch logs a warning on both sides (no
negotiation in the MVP). One frame is at most 1 MiB (`MAX_FRAME_BYTES`) on either hop.
Oversized RPC results return `-32011` with the original request id, never a truncated
success. Narrow `session.list` by topic/role/state and `board.get` by key; page board
history as below. An error serializing a mutation result does not undo its commit: keep
the original replay key when retrying.

The stable hub deployment default is TCP **8787** for both HTTP and WebSocket, including
Docker port publication. Endpoint overrides are deployment configuration; they do not
change the wire schema or protocol version. The interim single-LAN-subnet access policy
is defined in DESIGN §12 and the deployment runbook; KOM_KEY remains required.

## Caller identity

Every session-scoped method carries `session_id`. A shim never chooses it: agentd binds each
IPC connection to one session at `ipc.hello` and stamps `session_id` on every forwarded call.
The hub authorizes each call against that session's topic memberships (boards, session lists)
and derives authorship from it (board `author`, message `from`).

`ipc.hello` (shim, hook or CLI → agentd, once per IPC connection) carries the facts that binding
needs: `client` (`shim` | `hook` | `cli`), `pid` (the shim's own pid, which dies with the agent; a
hook's own pid), `ppid`, `cwd`, `vendor`, `vendor_session_id`, MCP `client_info` (shim),
optional caller `project_key` (`KOM_PROJECT`) and, for Claude Code hooks, `endpoint`, `token`,
`permission_mode`, `inbound_policy`. Vendor facts stay host-local; the resolved project key
is part of the public session. Claude binding requires both `vendor_session_id` and
observed process ownership (`ppid` plus its process birth). The hook's payload `session_id`
is authoritative for the current conversation. The shim's launch
`CLAUDE_CODE_SESSION_ID` is a legacy hint that can become stale after interactive resume;
concurrent Claude processes can also share the same conversation ID. Each provable live owner gets its
own hub identity and handle. The bundled MCP bootstrap relays its own observed parent PID
to its runtime child; manual shims use their direct parent. Missing or ambiguous ownership
fails explicitly, never selecting another owner by cwd. Without a vendor ID, a unique
owner match is still required. Bound peers cannot follow a replaced or ended owner; ownership is rechecked after
asynchronous probes/flushes/reads. A live hook-only owner does not require a native socket.
A unique prior owner may be resumed only with positive process-exit/PID-reuse evidence
and matching cwd/project;
otherwise register separately. Cold Claude context/registration is process-scoped, and
SessionEnd removes only that owner's replay authority. Bundled Claude plugins additionally
send optional positive `owner_generation` from their exact owner-scoped SessionStart journal.
A higher generation retires previous same-owner conversations; stale/missing generations
after fencing and equal generations naming another conversation are rejected. A shim
reopens its pinned IPC connection on generation change, even if its launch environment
still names the earlier conversation. Generation tombstones prevent ended registration
fallback, and delayed calls never replay against a successor. Duplicate resumed owners sharing a
native endpoint are downgraded to hook delivery; the shared socket is never used for private
traffic while ambiguous. `hello` (agentd → hub) identifies the host only.
The shared daemon runtime contract is 3; plugin clients reject earlier daemons and request
an explicit local restart rather than using unsafe old binding behavior.

Codex/local Work uses MCP tool-call `_meta.sessionId` and `_meta.threadId` for root
identity. They must be valid, equal IDs; missing/conflicting identity and fork calls fail
explicitly. A shim routes each root through its own pinned IPC connection with
`vendor: codex` and `vendor_session_id`; tool arguments cannot choose authorship.
Codex hooks report payload `session_id`, with an explicit vendor launch flag. Environment
IDs and cwd are not substitutes. The shim registers and owns liveness; hooks bind only an
existing root, so a SessionStart before the first MCP call safely does nothing. Hook
identity is the root session tree, not a separate subagent identity. No hub wire or
SQLite schema change is required.

Claude SessionStart may omit `permission_mode` (observed on 2.1.310). Its absence means
unknown, not `default`; later hooks may supply it. Neither that field nor the token alone
proves native delivery. `inbound_policy` is a host-local declaration from the launch
variable `KOM_CLAUDE_INBOUND_POLICY` (`default`, `accept`, `hold`, `refuse`); it never changes
Claude settings and is not sent to the hub. M1 requires explicit accept for bypass sessions.
Launch-scoped facts reset on process replacement/revival; an omitted marker on a new launch
cannot inherit the prior launch's accept declaration.
The `cli` role is for owner-local management; it does not bind a model session. Session
`capability` can be refreshed by daemon-owned `session.upsert update` after hook facts arrive;
MCP `set_status` cannot override it.

## Identifiers

Session names, host short names and roles share one grammar, `[a-z0-9][a-z0-9_-]{0,62}`
(`Ident`), lowercased on input; everything that can appear in an address is validated by it at
registration and rename. One live session per handle; a clashing name gets a `-<n>` suffix.

## Methods

| Method | Params | Direction | Shim tool |
|---|---|---|---|
| `ipc.hello` | see "Caller identity" | shim / hook / CLI → agentd | — |
| `hello` | `host, agentd_version, protocol_version` | agentd → hub | — |
| `session.upsert` | `op: register` (`session` without id, `reg_id`) · `op: update` (`session.id` + name/role/status_line/wake/capability) · `op: reincarnate` (`session.id`, fresh `reg_id`) — see DESIGN §3; replays by `reg_id` return the same identity/incarnation | agentd → hub | `whoami` (first call → register), `set_status` (→ update, excluding capability); hook `SessionStart`; daemon restart (→ reincarnate) |
| `session.gone` | `session_id, incarnation` — ignored when older than the current incarnation | agentd → hub | hook `SessionEnd` |
| `deliveries.resync` | `acked: { session_id → highest seq acted on }` — hub re-emits `deliver` for unread rows above each mark; sent after every (re)connect | agentd → hub | — |
| `session.heartbeat` | `session_id, state` | agentd → hub | hook `PostToolUse` |
| `session.list` | `session_id, topic?, role?, state?` — defaults to non-gone sessions; explicit `state: gone` lists history; only sessions sharing a topic with the caller | agentd → hub | `list_sessions` |
| `message.send` | `session_id, message, idempotency_key` — key is an agentd-chosen UUID; a repeat returns the existing message. Hub result: `{ id, deliveries, replayed }`. The shim's `send` tool returns `send.local`: that result as `{ status: "sent", … }` once acknowledged, or `{ status: "queued", idempotency_key, outbox_depth }` while the hub is unreachable — not a failure, not to be retried | agentd → hub | `send` |
| `inbox.list` | `session_id, since_seq, unread_only?, waking_only?, limit?`. Result: `{ headers: MessageHeader[], cursor, more }` — every header has the message `id` plus `seq`, `from`, `kind`, `subject?`, `preview` (first line, ≤ 200 code points), `thread_id`, `state`, `wake` (the hub's decision). Hooks use `unread_only` (oldest unread, no cursor); the Stop-time poll adds `waking_only` | agentd → hub | `inbox` |
| `message.read` | `session_id, id` (marks the delivery read). Result: `{ message: StoredMessage, state }` | agentd → hub | `read` |
| `receipt.mark` | `session_id, ids[] (≤ 200), state` | agentd → hub | `ack` |
| `topic.join` / `topic.leave` | `session_id, name` — ad-hoc topics only; `project:*` and `global` are refused by the schema | agentd → hub | same names |
| `topic.list` | `session_id, discover?` — defaults to joined topics; true adds ad-hoc names/kinds only | agentd → hub | `list_topics` |
| `board.get` | `session_id, topic, key?` | agentd → hub | `board_get` |
| `board.put` | `session_id, topic, key, body, if_version?, protected?, op_id` — author derived from `session_id`; `if_version` required for an existing key, checked in the handler's transaction; `op_id` is an agentd-chosen UUID stored on the created version, so a replay returns that version (`replayed: true`) instead of a conflict | agentd → hub | `board_put` |
| `board.history` | `session_id, topic, key, before_version?, limit?` (1–10, default 10). Newest first; result `{ entries, more, next_before_version }`. Pass the returned exclusive version cursor while `more` is true | agentd → hub | `board_history` |
| `status` | — | shim → agentd, agentd → hub | `status` |

Limits are characters (JS string length): subject 200, body 64,000, board key 120, board
body 16,384, topic name 120, ≤ 20 recipients per message.

Local IPC helpers are not forwarded verbatim to the hub:

| Method | Local behavior |
|---|---|
| `whoami` | Returns `{ session, topics }` after registration; missing/ambiguous binding is an error |
| `hook.poll` | `{ event, stop_hook_active? }` → `{ headers, cursor, more, block, session }`; Stop uses current wake policy and its one-shot latch |
| `hook.ack` | `{ ids }` → queued read receipts for headers already flushed to stdout |
| `daemon.status` / `status` | Local daemon/queue health and hub reachability; excludes vendor credentials |
| `daemon.diagnostics` | CLI-only read-only checks of live registered Claude socket presence and Codex shim liveness/observed hook polls; returns `claude_sessions` and `codex_sessions` (`id`, `shim_alive`, `hook_events`), never socket paths or tokens |
| `daemon.shutdown` | CLI-only graceful shutdown |
| `session.dnd` | CLI-only `{ wake, session? }`; target local ID/handle or all live local sessions |
| `human.send` | CLI-only `{ message }`; human origin requires the CLI's stdin TTY, otherwise agent origin and no force wake |

The daemon stamps identity and replay keys on forwarded session methods. A shim cannot
choose `session_id`, `idempotency_key`, `op_id`, `reg_id`, lifecycle operations, or capability.
The local socket protects the OS user boundary, not mutually hostile processes of one user.

## Notifications (hub → agentd)

| Method | Params | Meaning |
|---|---|---|
| `deliver` | `message: StoredMessage, session_id, seq, wake` | `message` always has the hub-assigned `id`, `thread_id` and `created_at`. `wake` is the hub's instruction for this delivery (wake rule applied, including `force_wake`); it is not the session's `wake` policy. `seq` is per recipient, gap-free, from `sessions.next_seq` |
| `config` | `coalesce_ms, hops_max` | runtime limits |

## Addressing

```
author@laptop            one session (name@host; host is the short name from config.json)
@role:executor           every session with that role
topic:project:<key>      every member of a topic
all                      everyone
```

See `packages/protocol/src/address.ts` and `ident.ts`.

Codex diagnostic hook events are process-local evidence collected after successful hook polls;
they reset when the daemon restarts or the session launch changes. They prove observed calls,
not that a model consumed context or that a desktop window supports native wake.

## Plugin-local setup (2026-10-28)

The stdio MCP entrypoint additionally exposes argument-free `setup_status` and `setup_start`.
They do not forward to the hub or select a session. `setup_status` returns `configured`;
when configured it also returns `daemon` (stopped/compatible/incompatible/unavailable),
`client_version`, `expected_runtime_contract`, nullable `daemon_version` and
`daemon_runtime_contract`, and `recovery` when action is needed. `setup_start` returns
configuration state and, only when needed, an expiring private loopback form URL.
MCP `status` calls `daemon.status` through a separate CLI-only read-only IPC connection;
it does not need session registration and never starts or restarts the daemon. Hub credentials never appear
in MCP parameters/results. Plugin root identity and project association require explicit
vendor selection, exact Codex call metadata and a matching private hook cwd observation;
missing/ambiguous context is an error. The hub/IPC wire schemas are unchanged.

`daemon.status` reports `runtime_contract: 3` for plugin compatibility preflight. This is
additive for existing CLI clients. Plugin MCP/hook clients refuse an active daemon missing
this exact contract; they never infer compatibility from the legacy `0.0.0` version.

`topic.join` results include `ok: true`, `created` (new topic) and `joined` (new
membership). Flags describe mutations in this call, not the original replay. `topic.list`
discovery returns the same name/kind records as joined listing; it does not expose members
or board contents, grant membership, or reveal another project's topic.
