# Explicit test-data cleanup contract

This is an operator-only, offline cleanup of reviewed test records, not retention or
automatic prune. The operator selects exact IDs in a private manifest; names, ages and
substrings never select records automatically. Ambiguous records stay in the database.

The dry run reads the database without migrating or modifying it, validates the complete
reference closure and reports counts plus a SHA-256 fingerprint of all affected rows.
Apply requires that exact fingerprint, an explicit stopped-hub acknowledgement and a
private `VACUUM INTO` backup before the deletion transaction. The operator stops the hub;
the command does not stop services or claim that an acknowledgement detects processes.
The transaction repeats validation under its write lock, so changed data aborts safely.

Only ended sessions may be removed. A selected host or topic cannot contain retained
sessions, memberships, message targets or board data. Selected messages cannot have retained
reply/thread references. Session authorship, deliveries and board-history authors cannot
point outside the selected closure. Protected boards are refused. Membership removal does
not renumber retained session delivery counters. Real sessions authoring selected synthetic
messages remain present unless separately selected and independently eligible.

Schema 6 adds a small `retired_operations(kind, operation_key)` table. Upgrading schema 5
adds it transactionally without replacing any existing data; unsupported versions still
fail closed. The cleanup transaction preserves registration, message and board-operation
keys in this table before removing their payload rows. Replaying a retired key returns a
permanent conflict rather than creating a new session, delivery or board entry. Tombstones
carry no message bodies, author display, board content or registration snapshot. A retired
session cannot reincarnate because its identity no longer exists. Fresh operation keys are
new operations, not retries; this cleanup does not ban future deliberate test creation.

An atomic completion receipt in the same table binds the fingerprint and manifest selection
hash in its key, so another manifest cannot reuse a completion acknowledgement.
A repeated completed apply validates that all selected primary records remain absent and
returns a replayed result. It never deletes a newly recreated topic, host or board. Failed
validation rolls back every mutation. General prune remains disabled.

The tool does not erase client caches, independent observer journals or private backups.
Operators must confirm selected synthetic observer jobs are complete before removing their
hub sources. Those durable journals may retain replay information but must not be rewritten
to invent acknowledgements. Backups and manifests remain private and outside the repository.
