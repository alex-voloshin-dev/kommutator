# Retry negative project discovery

## Scope and assumptions

Feedback #455 (`8d7868bb-b07d-48e6-9556-65d853ca6fb4`) describes a daemon started
before a directory became a Git repository. The permanent cached miss kept a later
independent session on the basename project, although `remote.origin.url` then existed.
The follow-up #456 withdrew the immediate migration request, not the cache defect.
The direct maintainer request to process confirmed feedback is the implementation plan.

Only unsuccessful discovery is changed. Concurrent callers share one in-flight lookup;
missing results and rejected lookups are evicted after settlement. Each caller still
gets its own fallback. Successful normalized remotes remain cached for the daemon
lifetime. No new timer, dependency, schema, protocol or retry of a mutation is introduced.
The Git probe retains its existing 50 ms deadline and 4096-byte output limit.

## Identity boundary

A fresh independent owner discovers the new remote. Existing session/project records,
membership, outbox entries and boards are not rewritten or moved. Claude's existing
`registerOwner` context fence still rejects a refresh whose resolved project changed,
with `Conflicting project context ... start a fresh session`. Its already bound connection
continues to identify the original session and project. Thus creating a remote can require
an existing fallback-based Claude owner to start a fresh session; this change intentionally
does not invent project migration or relax owner authority. Codex existing registry records
also retain their original session fields. Positive remote changes are outside this fix.

## Validation on 2026-11-24

Independent frozen-lockfile dependencies in this worktree; Node 26.13.0 / pnpm 12.18.0.

- Unchanged baseline `c155592`: new project tests failed 3/6 (retry after miss,
  in-flight miss eviction, retry after rejection); positive cache controls passed.
- Unchanged baseline source with new real-core test: 1 failure at the expected canonical
  project assertion after `git init` and `git remote add`; 123 unrelated tests filtered out.
- Candidate: `pnpm -r build` and `pnpm -r typecheck` passed in order.
- Candidate focused tests: 8 passed, 122 filtered out. Includes real Git initialization,
  fresh Claude owner registration, existing-owner context rejection, unchanged original
  identity/topic membership, and the existing changed-cwd ownership regression.
- Full workspace test/release qualification, independent review and QA are not claimed
  by this implementation report. They remain integration gates.

Logs: `/tmp/kom-project-baseline.log`, `/tmp/kom-project-baseline-core.log`,
`/tmp/kom-project-build.log`, `/tmp/kom-project-typecheck.log`,
`/tmp/kom-project-focused.log`. Baseline tests used the unchanged source and did not share
mutable dependencies with another checkout. No production daemon, hub or database changed.
