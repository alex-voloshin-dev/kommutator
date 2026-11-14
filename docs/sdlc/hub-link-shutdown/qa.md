# Hub link shutdown QA

Date: 2026-11-14. Independent QA against engineer commit
`4b4c16c874bde93c3dc2521fb2d2c1227cd6848c` in the bounded-resync worktree.
No production services, MCP sessions, configuration or deployment were changed.

## Coverage added

- Positive controls retain fixed diagnostics for an active WebSocket handshake
  failure and active synchronization rejection. The remote/error text is not
  exposed. These complement the five engineer shutdown regressions: connecting
  socket close, late synchronization rejection, never-started link, already-closed
  socket with reconnect pending, and explicit close with an unanswered request.
- Transport fixtures own startup before awaiting it or asserting the number of
  successful starters. Cleanup waits for startup and closes the daemon before
  deleting its home. A continuation cannot receive a daemon after cleanup began.
- Deterministic deferred-start tests cover cleanup during startup, idempotent
  close, preservation of the original startup rejection, cleanup of both successful
  starters after a failed single-winner assertion, and propagation of close errors.
  No startup retry or longer deadline was introduced.

The fixture bug is independently supported by the prior ordering of startup,
assertion and cleanup registration. It does not establish why startup was slow or
why the earlier release gate timed out. The helper waits for pending startup;
it does not cancel a permanently stuck startup. An eventual framework cleanup
failure remains a failure, rather than being converted to a passing test.

## Executed checks

Pinned Node 26.13.0 / pnpm 12.18.0; commands ran serially with exclusive QA access.

- Targeted shutdown, fixture ownership and daemon transport: **15/15 passed**.
  Log: `/tmp/kom-shutdown-qa-targeted.log`.
- Final `pnpm -r build`: exit 0, `/tmp/kom-shutdown-qa-build.log`.
- Then `pnpm -r typecheck`: exit 0, `/tmp/kom-shutdown-qa-typecheck.log`.
- Then `pnpm -r test`: exit 0, **792/792 passed** (41 protocol, 208 hub,
  249 agentd, 294 CLI), `/tmp/kom-shutdown-qa-tests.log`.

No QA checks failed in this scope. Runtime behavior was not changed by QA.
Assertions and the 300 ms temporary hook process limit remain unchanged;
140/90 ms internal hook timers remain unchanged.

## Retained failures and limits

The earlier integrated release check in `/tmp/kommutator-v0160-release-check.log`
failed six tests across daemon-core, daemon-transport, operation-recovery-boundaries
and registry-migration. This passing run does not explain those timeouts. The
proved shutdown lifecycle defect and fixture ownership gap must not be presented
as a general explanation of the six failures, field hub availability, or historical
registration failures. Live 0.15.2 health timeouts are separate observations.

This QA gate does not replace packaging, integrated release qualification, public
install checks or deployed health checks. No new product defect was found by the
added tests. The preexisting day-long, physical LAN, unattended reboot and native
client/wake gates remain outside this scope.
