# ADR 001: Resolve a fresh project audience on the hub

## Context

`all` spans visible sessions, while project-topic subscriptions survive absence. Neither means
currently live peers of the caller's project. Recipients and replay authority belong to the hub.

## Decision

Add `@project`, deriving the project from the owned sender and requiring automatic project-topic
membership. A missing/null sender project rejects before inserts with project-registration
guidance; no inferred/global/fallback audience or zero-recipient success is permitted.
Snapshot active/idle, non-ended peers with session heartbeats no older than 60 seconds,
excluding the sender, at first hub acceptance. Union mixed targets by stable session ID. Persist
a project target and immutable deliveries. Replay never resolves the audience again. Bump hub
schema 6 to 7 to fence readers unable to decode project targets; preserve all existing data.

## Alternatives considered

- Change `all` to project scope: convenient but breaks existing cross-project callers.
- Alias to the project topic: little implementation cost but includes ended/absent subscribers.
- Expand on the client: can use existing handles but trusts stale caches, splits authority, and
  changes the meaning of offline enqueue; hub acceptance is the coherent snapshot boundary.
- Reuse existing non-ended predicate without freshness: avoids another predicate but admits
  old/unknown peers despite the requested live audience. The documented 60-second window supplies
  a defensible boundary without changing old audiences.
- Persist new target types without version fencing: avoids a migration but permits old code to
  reopen a database it cannot interpret correctly.

## Consequences

Delayed heartbeats may exclude a reachable session; the selector promises a snapshot, not delivery.
Old clients remain compatible with an upgraded hub, but the whole send path must support the new
syntax. No automatic fallback or retry clears blocked old-hub rejections. Zero recipients is a
valid immutable outcome. Backups and fix-forward preserve historical and replay state.
