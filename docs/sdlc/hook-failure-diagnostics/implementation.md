# Bounded hook failure diagnostics

## Scope and assumptions

Feedback #484 (`a6ee18fa-aa1c-4c81-a1e6-e7499d769481`) reports two failed Codex hooks
on remote version 0.16.1, followed by successful hooks. It provides no error code or
phase. The historical cause is not established and this change does not claim to
repair that startup failure. The confirmed defect is loss of diagnostic distinctions:
registration rejection, a silent IPC hello and a silent method all persisted `failed`.

The direct maintainer request supplies the implementation scope: preserve future bounded
failure evidence without altering registration, transport retry, output or receipt rules.
Prior decisions: `docs/knowledge/operability-evidence.md` separates observations from
acceptance; `codex-root-identity.md` requires exact roots and forbids inferred identity.

## Change

- Add optional fixed `reason` and `phase` fields to the private 64-slot observation record.
  Old records remain readable; unknown detail values are rejected on read and projected
  away on write. The existing 512-byte maximum read remains unchanged.
- Add fixed local metadata to IPC timeout/RPC errors and socket connection failures.
  Original numeric/string error codes and error messages retain their existing behavior;
  only the allowlisted reason and phase reach observation storage.
- Distinguish connection/hello from whoami, poll, acknowledgement and session retirement,
  plus input/authority/configuration stages. Never store raw method text, parameters,
  remote error messages, paths, credentials or the raw root ID.
- Preserve original outcomes, especially `output-written-ack-unverified`, as well as
  single attempts, 140/90 ms deadlines, fail-open behavior and authorization fences.

This is plugin-local diagnostic metadata, not a hub wire method or schema/runtime-contract
change. No observation proves delivery or that a timed-out mutation was not committed.
The hard entrypoint deadline can still interrupt diagnostic flush; missing data is unknown.

## Verification

- Before implementation, all three real Unix-socket regressions failed on missing detail:
  rejection during hello, silence during hello and silence during whoami. The baseline
  retained generic `failed` for each. Log: `/tmp/kom-hookdiag-baseline.log`.
- Ordered workspace build and typecheck passed after implementation.
- Six focused files passed, **42 tests**: hook failure detail, observation storage,
  rejection outcome, retirement outcome, IPC client and existing hook receipt behavior.
  Log: `/tmp/kom-hookdiag-focused2.log`; build/typecheck logs use the same prefix.
- Coverage includes actual Unix-socket EACCES with unchanged string code, no replay,
  private-file bound/legacy parsing, malicious detail rejection, permission/read-only
  categories, and output-before-ack uncertainty.
- An earlier focused run failed four existing mock-call arity assertions after adding
  optional metadata. Expectations now retain the original outcome/identity assertions
  and additionally check the new phase. This was not a production behavioral failure.

Independent review/QA and the integrated full release gate are still pending. No live
daemon, hub, private configuration or database was modified by this work.

## Review follow-up: transport closure during hello

Review found that a socket error/close after connection but before the hello reply could
still be attributed to the outer `whoami`/poll. A new real Unix-socket close-after-hello
regression fails on the first candidate with `phase: whoami` instead of `ipc-hello`.
The transport callback now checks this socket's pending hello before clearing waiters;
it retains the same codes, error messages, rejection and reconnect behavior. No ownership
or per-request replay semantics changed.

Ordered build/typecheck and the expanded six focused files passed, **43 tests**.
Logs: `/tmp/kom-hookdiag-close-{baseline,build,typecheck,focused}.log`.
