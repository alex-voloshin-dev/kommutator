---
type: release
feature: board-cli
status: approved
version: 0.11.0
changelog:
  - "Added: read-only board get/list commands with explicit local session selection."
  - "Fixed: board help now documents usable commands and required arguments."
breaking: []
---

# v0.11.0

Read current board entries from the terminal:

```sh
kom board get --session <hub-session-id> --topic <topic> --key <key>
kom board list --session <hub-session-id> --topic <topic>
```

Choose an exact live local session ID from `kom status`. The session must already
belong to the topic. Output is JSON containing entry bodies and version metadata;
a missing key returns an empty entries array. `kom board --help` and subcommand help
now describe the available commands. Positional topic/key syntax is not supported.

Upgrade the client and restart the local daemon to load this support. No hub schema,
wire shape or runtime-contract bump is needed. Reads never start the daemon, register
sessions, join topics, write boards, wake agents or advance receipts. `board revert`
remains deferred. Older daemons fail explicitly until upgraded/restarted.

## Validation

Node 24.22.2 and pnpm 10.18.0. Frozen install, ordered workspace build/typecheck/test,
and `pnpm release:check` passed. Workspace: 508 tests (protocol 34, hub 174,
agentd 102, CLI 198). Release script tests: 114. Fresh Linux x64 export verification,
clean-PATH Claude/Codex smoke and synthetic packaged end-to-end checks passed,
including shared daemon restart and offline queueing.

Independent code/security review and QA approved. Source and full Git history scans
with CI-pinned Gitleaks 8.30.1 found no secrets. Artifact scanning flagged two runtime
manifests; every flagged manifest field was inspected and all file/runtime hashes
were recomputed successfully, confirming public content hashes rather than credentials.

Earlier runs exposed intermittent existing hook deadlines/SessionEnd behavior and a
packaged daemon restart failure. Isolated diagnostics passed, then the complete release
gate passed without concurrent validation jobs. No assertions were weakened. The cause
of those intermittent failures is unproven; passing reruns do not establish long-term
reliability. An initial CLI typing issue was corrected before the final checks.

## Not validated

No live hub/daemon or vendor configuration was changed. Real vendor installation and
exchange for this release, non-Linux-x64 execution, day-long reliability, reboot/logon
and physical allowed/denied-subnet acceptance remain open.
