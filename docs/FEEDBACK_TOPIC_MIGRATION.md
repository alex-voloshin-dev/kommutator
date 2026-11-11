# Move feedback to the hyphenated topic

The current feedback topic is `kommutator-feedback`. New ad-hoc topic names must not
contain whitespace; separate words with hyphens. The historical `kommutator feedback`
topic remains an archive. It is not an alias and new posts there are not monitored after
migration. Other existing topics are not renamed.

This procedure is for operators who already run the optional observer, either alone or
with the optional maintainer, using the old spaced topic. Fresh installations use the new default and do not migrate.
It preserves the existing observer mailbox, cursor, host/session identity, pending jobs,
report IDs and replay keys. Do not edit SQLite rows or erase either state directory.

1. Build the updated checkout with Node 26.13.0 and pnpm 12.18.0:

   ```sh
   pnpm install --frozen-lockfile
   pnpm -r build
   ```

2. Wait for any running engineering worker to finish and stop the maintainer between jobs.
   Check `node scripts/feedback-maintainer.mjs status` using the currently installed version.
   Do not interrupt a worker that might already have published a release. Then stop the
   observer as well:

   ```sh
   systemctl --user stop kommutator-maintainer.service
   systemctl --user stop kommutator-feedback.service
   ```

3. Run the migration from the updated checkout:

   ```sh
   node scripts/migrate-feedback-topic.mjs apply
   ```

   For a standalone observer that has never used a maintainer, use the explicit mode instead:

   ```sh
   node scripts/migrate-feedback-topic.mjs apply-observer-only
   ```

   Standalone mode requires no maintainer installation, policy, engineering skills or release
   authorization. Skip the maintainer status/stop/start commands in this procedure. It takes
   only the observer lock and stores its backup and recovery marker in the observer state
   directory. It rejects any existing maintainer state directory, policy file, or observer
   publication metadata from a maintainer. Partial/disabled maintainer installations still
   require the joint migration; do not delete their files to bypass that check.

   The absence checks use default or explicitly supplied maintainer paths. If this observer
   ever used custom maintainer paths or `--result-db`, supply those paths and use the joint
   mode. The command cannot discover arbitrary former paths. Resume interrupted migration
   using the same mode and paths; do not switch modes or remove its marker.

   Defaults use `~/.local/state/kommutator-feedback`,
   `~/.local/state/kommutator-maintainer`, `~/.config/kommutator-maintainer/policy.json`
   and `~/.kommutator/config.json`. For custom paths, supply `--observer-state`,
   `--maintainer-state`, `--policy` and `--config` explicitly. This command does not infer
   `$KOM_HOME`; use `--config` for that installation. Both services must use the same paths.

   Joint mode takes both service locks, rejects a running worker, and creates private
   `VACUUM INTO` backups plus a policy copy. Standalone mode backs up the observer journal only. It joins the new topic using the existing
   observer session, captures its available inbox and reads missing bodies without running
   a model. This capture establishes the archive cutoff. Posts on the old topic after that
   boundary are ignored. Messages posted to the new topic before this observer first joined
   it require a separate history audit; membership is not retroactive.

   Capture is bounded to 15 seconds and 100 inbox pages. A disconnected hub, expired session,
   mismatched configuration or incomplete capture aborts safely. Keep services stopped,
   resolve the cause and rerun the same command. Do not remove `topic-migration.json`.
   Incomplete migration metadata fences updated service startup, including after a reboot.
   A completed rerun reports `replayed: true` and does not reclassify live traffic.

4. Remove any explicit old `--topic` argument from the observer unit, or replace it with
   `--topic kommutator-feedback`. Preserve its state/config/result paths. Publish a short
   redirect notice to the old topic through your existing client, and direct people to
   `kommutator-feedback`. Archive is an operational convention; the hub does not make the
   old topic read-only. Do not leave its membership while historical replies are pending.

5. Deploy the matching hub release before starting the updated observer. In particular,
   a pre-0.6 hub lacks the topic-join result fields used by the updated client. A healthy
   TCP endpoint alone does not establish client compatibility. Keep both feedback services
   stopped while the hub and local daemon are upgraded; retain their persistent databases.
   Then explicitly restart the services after the migration succeeds:

   ```sh
   systemctl --user daemon-reload
   systemctl --user start kommutator-feedback.service
   systemctl --user start kommutator-maintainer.service
   node scripts/feedback-observer.mjs status
   node scripts/feedback-maintainer.mjs status
   ```

   Confirm the observer retains its session ID and cursor, joins `kommutator-feedback`, and
   advertises `Monitoring kommutator-feedback`. Historical unfinished work may still publish
   to its original topic; all new feedback and new maintainer reports use the canonical topic.
   Keep backups private. Restoring an old backup after live work has resumed can replay stale
   work, so recovery should normally resume the migration rather than roll back journals.

Automated checks: `pnpm test:feedback-topic-migration`. They use temporary journals and
synthetic messages; they do not mutate the operator's hub or publish releases.
