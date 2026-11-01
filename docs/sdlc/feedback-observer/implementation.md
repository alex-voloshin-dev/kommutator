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

## Installed acceptance — 2026-11-01

The reviewed observer was installed as a private systemd user service on the WSL host.
`systemd-analyze --user verify` passed. The unit is enabled and running; user lingering
is enabled. It uses the existing local Codex 0.164.0 ChatGPT authentication and the
operator's configured model/effort, without changing that interactive configuration.
The journal directory is mode 700, its database and unit are mode 600. Hub credentials
are read from the existing private client configuration, not copied into the unit.

A real synthetic feedback message produced one board entry (version 1) and one FYI
reply in its original thread after the advisory compatibility fix. A second message,
sent while the service was stopped, produced its own board entry (version 1) and reply
after restart. Processing took approximately 8 and 22 seconds from the respective
model invocations; the second waited for the configured 60-second cooldown. These are
individual observations, not latency or capacity guarantees.

After another service restart, the observer retained the same hub session ID and
handle, with incarnation advancing from 0 to 2. Both completed jobs remained done;
its own replies were ignored. The original interactive Codex session retained its
identity and connection. No duplicate reply or board update was observed in the
post-restart polling window. The journal's last error cleared after successful triage.
No hub or interactive daemon restart was needed.

The enabled Windows WSL-start task was observed to use a logon trigger. Actual Windows
reboot, long-duration availability and external-subnet acceptance were not tested.
The observer runs only while WSL and the user systemd manager are running. A stopped
or unavailable local Codex login/model prevents replies but retains queued work.

Final gates: 15 observer tests, 29 existing script tests, workspace build/typecheck and
372 workspace tests; independent correctness/security/QA and external round-two
approval. Source and Git history secret scans passed, including comparison against
known local credentials. Only the synthetic test key has an exact path/value exception.
