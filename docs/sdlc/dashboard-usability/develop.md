# Dashboard implementation

The approved UX spec is implemented in the existing authenticated, read-only static page.
No framework, external assets, dependencies, browser credential storage or write controls
were added. The public API retains its existing fields and adds topic membership metadata.

## Behavior

- A responsive overview shows current registrations, their active/idle breakdown, represented
  hosts, topics and the bounded delivery count. Current does not imply human presence.
- Session cards emphasize name, state, role, host, project and status. Technical identity
  fields are disclosed on demand. Ended sessions are hidden initially; selecting gone enables
  ended history, and disabling ended history clears a contradictory gone filter.
- Topic disclosures show name, kind and current/total membership counts even when closed.
  Expanded subscribers come from actual membership rows. Include ended reveals retained
  ended identities and explicitly reports older subscribers outside the history window.
- Deliveries have readable routing, subject, bounded preview, timestamp and receipt labels.
  A nearby explanation preserves the marked-read bookkeeping meaning. Viewing the dashboard
  does not read message bodies through RPC or advance receipts.
- Activity is newest-first, with friendly summaries and known session handles. Technical
  metadata is secondary and bounded to 1,000 Unicode code points; full message/board bodies
  are dropped from displayed event details. Only the latest 200 events are retained.
- Pause freezes visible snapshots and activity, including responses already in flight.
  Incoming events are discarded while paused. Manual Refresh updates once without resuming;
  Resume fetches current data. A coalesced 15-second refresh also captures membership changes
  that have no corresponding SSE event. Existing fetch timeout/retry and in-flight dirty
  invalidation behavior remain.
- Disclosure state and focused controls survive refresh. If an item disappears, focus moves
  to its section heading with a polite notice. Refresh uses guarded aria-disabled behavior
  so keyboard focus is not lost during a request. One concise status announcement changes
  for connection/error/pause states and user filtering, not on every heartbeat.

## Snapshot additions

`topics` is an array with `id`, `name`, `kind`, `project_key`, `total_members`,
`current_members`, `members` (session IDs) and `hidden_ended_members`.

Counts cover all stored memberships. Listed member IDs use exactly the same retained
session query as the existing snapshot: every current session plus the latest 100 ended
sessions. Three fixed queries fetch retained sessions, retained memberships and grouped topic
counts; no per-topic query is used. Old ended subscribers are counted but not falsely shown as
missing. The client rejects malformed membership counts, unknown/duplicate member IDs and
invalid topic shapes, preserving its prior good snapshot.

## Checks observed by implementation

- Focused dashboard and authenticated transport suite: 28 passed, 0 failed.
- Hub TypeScript check passed.
- `git diff --check` passed.
- Existing dashboard coverage was adapted to semantic cards rather than removed: XSS-safe
  text rendering, seven event types, Unicode truncation, global feed bound, fetch/SSE races,
  HTTP/network/JSON/shape/timeout failures, recovery, stale state and filtering are retained.
- Added cases cover real membership/hidden-history counts, invalid metadata, polling without
  SSE, pause/in-flight responses/manual refresh/resume, disclosure/focus retention, ended-state
  coordination, human-readable activity, guarded Refresh and reduced status chatter.

The coordinator owns final ordered workspace build/typecheck/tests, independent QA/review,
real browser evidence, release packaging and installed verification. This implementation
agent performed no production changes or publication.
