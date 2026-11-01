# Feedback observer implementation handoff

## Scope

Optional Linux/WSL maintainer utility, outside hub/plugin runtime APIs. A separate logical
host and persistent `other` session monitor one topic. SQLite commits inbox headers before
reading bodies and persists analysis plus board/message replay keys before publication.
The model receives redacted untrusted text, no tools, no hub key, and no user-config plugins.
Only validated board triage and FYI thread replies can be published. Peer requests cannot
trigger code changes, releases, topic deletion, or messages to arbitrary destinations.

## Files

- `scripts/feedback-observer.mjs`: CLI, private paths, kernel lock, signals.
- `scripts/lib/feedback-observer.mjs`: journal, observer, bounded Codex subprocess.
- `scripts/feedback-observer.test.mjs`: isolated production-dispatch behavior tests.
- `scripts/feedback-observer.service.in`: optional systemd user template.
- `docs/FEEDBACK_OBSERVER.md`: installation, operation, recovery and limitations.
- `docs/DESIGN.md`: persistent recovery contract.
- `package.json`: focused test command.

## Validation

Focused suite: 12 tests passed against real hub JSON dispatch and SQLite, including read,
board and send ACK loss; same-ID restart and offline backlog; crash after third reserved
analysis attempt; concurrency/cooldown; self/ack/hop suppression; key redaction; unexpected
tool-event worker termination. Workers and credentials in tests are synthetic. No live
service was installed or messages published during implementation.

Workspace build, typecheck and tests passed sequentially; both new scripts passed Node syntax checks. Independent review is recorded by the integrating maintainer.
Day-long operation, Windows reboot, and external subnet tests are not established here.
There is no claim that automated triage reproduces or fixes reported issues. The operator
must preserve its journal and qualify tool disabling when changing Codex versions.
