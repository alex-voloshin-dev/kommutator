# ADR 002: Index the complete resynchronization page query chain

Status: proposed; pending bounded-resync design review round 3.

## Context

The initial design limited the page metadata query to 33 unread rows. The external
review correctly identified that the current `packages/hub/schema.sql` unique
`(session_id, seq)` index does not index the `state = 'unread'` predicate. A query
can traverse an arbitrarily long sequence of read rows before returning its 33
matches. The synchronous hub would still perform backlog-sized work per request.
The second review additionally identified an unindexed `targetsFor` lookup during
`getStoredMessage`: each candidate could scan the entire `message_targets` table.
Both findings must be addressed in the complete query chain.

## Decision

Add `deliveries_unread_session_seq` on `(session_id, seq) WHERE state = 'unread'`.
Keep the page predicate literal so SQLite can use the partial index, and qualify
the query plan on sparse unread history. This yields an indexed range seek plus
at most 33 matching metadata entries; it does not promise fixed wall-clock latency.
The highwater MAX query continues to use the existing full sequence index.
Add `message_targets_message_id` on `message_targets(message_id)` as well. Bound
the target lookup to 21 rows (the valid original-address limit is 20) and reject
overflow rather than truncating. Qualify its plan against large unrelated target
history. Message/session reconstruction uses existing primary-key lookups.

Bump hub `SCHEMA_VERSION` to 8. Fresh databases create both indexes; an explicit
transaction migrates schemas 5/6/7 to 8, including the prior schema-5 migration when
required. Roll back both indexes and version changes on failure, including failure
while building the second index. Existing row fields and replay
data are unchanged. Keep daemon schema 5 and runtime contract 4.

## Alternatives considered

1. **Bounded unfiltered sequence scan.** Select at most 33 deliveries regardless of
   state, filter unread in memory and advance a scan cursor over examined rows.
   This avoids a migration and bounds examined metadata, but permits nonterminal
   empty pages and requires distinct examined-versus-returned cursor semantics.
   A large historical read gap could require thousands of network round trips
   while delivering nothing. It is viable where a schema change is prohibited;
   here the repository already supports additive migration and the index is the
   simpler recovery contract with materially better sparse-history progress.
2. **Full index `(session_id, state, seq)`.** It also supports unread lookup and
   would permit explicit state comparisons, but retains index entries for every
   historical read delivery. The current query needs unread only and the existing
   unique index already serves all-state sequence ordering; a partial index avoids
   duplicating the full retained history unnecessarily.
3. **Keep only `LIMIT 33`.** This limits output and temporary result storage, but
   not scanning work. It does not meet the stated per-RPC work requirement.
4. **Create an index without a schema bump.** Although indexes do not alter row
   meaning, the contributor contract requires a version for SQL layout changes.
   An unversioned index makes qualification and operator checks ambiguous, so it
   is rejected in favor of an explicit supported migration.
5. **Cache or denormalize original targets.** Persisting target JSON on messages
   would eliminate the lookup but requires backfilling/changing stored representation
   and replay comparison paths. An in-memory cache cannot bound first access and
   adds invalidation/memory concerns. The simple lookup index preserves representation
   and provides indexed access for the bounded original-address list.

## Consequences

- Page cursor equality rules remain simple: nonterminal cursor is the final returned
  delivery sequence; terminal cursor is the fixed highwater. There are no empty
  nonterminal scan pages.
- Receipt updates automatically remove read rows from the partial index without
  altering receipt semantics or requiring a second reconciliation mechanism.
- Both indexes occupy disk and cost one-time construction scans. Migration timing
  must be qualified and accounted for in the maintenance announcement.
- The updater must preserve its ordinary backups and verify the actual schema/indexes
  after activation. Schema-aware operator helper guards/tests must be audited.
- Older hub binaries reject schema 8. Restoration of stale history is not an
  automatic rollback; deployment remains fix-forward after new operations.
- The complexity claim is indexed seeks plus bounded page payload and target lists,
  not constant I/O. Local wake-discovery scans and unrelated RPC fanout are outside
  the hub page-handler guarantee.
