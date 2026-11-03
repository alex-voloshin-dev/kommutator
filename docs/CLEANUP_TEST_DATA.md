# Remove reviewed test data

The dashboard is read-only. Database cleanup is a separate operator task with a private
backup and an explicit list of reviewed records. It is not automatic retention or prune.
Do not select everything that is old, ended, or happens to contain the word “test”.

Use Node 24 and the checkout matching the deployed hub. The hub must already have upgraded
its database to schema 6. Earlier schemas are refused by this command; dry runs never migrate
or modify a database. Build before running the test suite with `pnpm test:data-cleanup`.

1. Identify exact synthetic session/message IDs, topic IDs, host names and board keys from
   recorded test evidence. Retain any uncertain real work. Confirm independent observer or
   maintenance jobs using these messages are complete. Store a JSON manifest outside the
   repository with mode `0600`:

   ```json
   {
     "version": 1,
     "reason": "Remove the completed isolated acceptance fixture",
     "sessions": ["example-ended-session-id"],
     "messages": ["example-message-id"],
     "topics": [],
     "hosts": [],
     "boards": [{ "topic_id": 1, "key": "example-test-board" }]
   }
   ```

   These are placeholders, not a selection for your database. There are no wildcard,
   substring or age selectors. All arrays are required. Omit real authors from `sessions`
   when only their explicitly synthetic messages should be removed.

2. Pause optional maintenance/deployment jobs between tasks, then stop the hub using its
   normal deployment commands. Do not interrupt an engineering worker during publication.
   Clients may temporarily queue outgoing work. Run the dry run:

   ```sh
   node scripts/cleanup-test-data.mjs --db /private/hub.db --manifest /private/cleanup.json
   ```

   Review the counts and the selected IDs. The tool refuses active sessions, protected boards,
   retained references, shared hosts/topics and missing selections. Put the returned
   `fingerprint` into the manifest as `expected_sha256`. If validation fails, examine the
   references; do not expand the selection automatically to include real work.

3. Prepare a private backup directory owned by the current user with mode `0700`. Apply using
   a new backup filename:

   ```sh
   node scripts/cleanup-test-data.mjs --db /private/hub.db --manifest /private/cleanup.json \
     --apply --hub-stopped --backup /private/backups/before-cleanup.db
   ```

   `--hub-stopped` is the operator's acknowledgement; it does not detect or stop processes.
   The database must be owned by the current user with mode `0600`. Apply rechecks the data,
   creates a private `VACUUM INTO` backup, then validates again under a transaction lock.
   Changed rows, invalid references or an existing backup file abort the operation.
   No server-side credentials are required because this is offline local maintenance.

4. Check the result and restart the hub, then the paused optional services. Confirm real
   sessions reconnect and the dashboard shows their data. A completed repeated apply of
   the same manifest reports `replayed: true` with zero removed rows. Recreated selected
   records cause refusal rather than another deletion. Keep the private backup and manifest.

Minimal operation-key tombstones remain after payload deletion. They prevent old registration,
message and board retries from restoring deleted test data: those retries receive a permanent
conflict. Retained mailbox sequence counters are never reset. Client caches, observer journals
and private backups are not erased by this tool; it does not fabricate read receipts.
