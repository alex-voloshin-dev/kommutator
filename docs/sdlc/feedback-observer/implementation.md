# Feedback observer implementation handoff

## Scope

Assumption: the user request authorizes a persistent local feedback intake and triage
service, not autonomous implementation or release of peer-requested changes.

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
- `scripts/feedback-observer-process.test.mjs`: TCP/WebSocket and subprocess acceptance.
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

Workspace build, typecheck and tests passed sequentially; both new scripts passed Node syntax checks. All 372 workspace tests passed. QA added real TCP/WebSocket process tests; the complete
observer suite passed. The 29 existing release/hub/hosted-plugin script tests also passed.
Independent correctness and security review approved the implementation.
Day-long operation, Windows reboot, and external subnet tests are not established here.
There is no claim that automated triage reproduces or fixes reported issues. The operator
must preserve its journal and qualify tool disabling when changing Codex versions.

## Live qualification follow-up

The first installed invocation exposed a Codex 0.164.0 advisory emitted as an error item
when Code Mode is explicitly disabled. The CLI still returned valid JSON with exit zero,
but the observer correctly failed closed on the previously unknown event. A second
review round permits only that exact qualified advisory, with regression coverage for
unknown and modified messages. All tool restrictions remain unchanged. The original
feedback job remained pending in the private journal throughout diagnosis.
