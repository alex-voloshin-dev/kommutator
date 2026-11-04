# Session delivery reliability

## Scope and assumptions

The user's request to address the reported problems is the implementation scope: defer
Codex registration without a verified process birth, distinguish hub transport failures
from local daemon failures, expose read-only caller/hook diagnostics, and provide an
explicit topic observer. The approved research brief separates the reproduced missing-birth
defect from the historical process-exited event, whose root cause remains unproven.

## Implementation

Codex registration rejects unknown ownership before creating or changing a local record.
Caller status uses validated per-call root metadata and the actual MCP shim PID/birth,
without registration side effects. Legacy caller selectors fall back to explicitly
unverified diagnostics. Hub outages and daemon stopping have distinct bounded IPC errors;
neither claims a timed-out mutation was queued.

Hooks retain their fail-open deadline and record bounded private allowlisted observations.
An attempted, absent or interrupted observation is not successful delivery. Output followed
by acknowledgement failure is distinguished from a silent failure.

The explicit CLI watch observes one existing local session's authorized topic deliveries,
including read headers, through an independent cursor. It never registers, joins, reads
bodies or advances receipts. Default tail initialization and pagination share transactional
highwater snapshots. Local lifecycle changes suppress stale responses; DND/gone pauses the
cursor. Peer content remains untrusted. Cursor persistence, automatic monitor installation
and native vendor idle wake are outside this change.

## Review and verification

Implementation, correctness review, security review and QA use the isolated feature
worktree. Preliminary review caught ended-session rejection before the watch pause branch;
it was corrected and covered. Review also added conservative legacy-daemon fallback and
nonblocking handling of corrupted diagnostic slots. External review approved with a minor
clarification: topic departure while locally paused is detected on the next active poll.

Final test and release evidence is recorded in the final code review and deployment
artifacts. Synthetic tests do not establish live Claude Monitor or Codex native idle wake.
Existing day-long, subnet and reboot gates remain open.
