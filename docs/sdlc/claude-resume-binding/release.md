---
type: release
feature: claude-resume-binding
status: final
version: '0.3.0'
changelog:
  - 'Fix Claude in-process resume binding with owner generations'
  - 'Add an optional persistent feedback observer'
  - 'Recognize the qualified Codex fail-closed advisory in the observer'
breaking:
  - 'Client daemon runtime contract 3 and local state schema 2 require updating all client plugins before restarting the daemon'
---

# kommutator 0.3.0 — reconnect resumed conversations

## Fixed

A long-lived Claude MCP process can retain its launch conversation ID after the user
resumes another conversation. The plugin now resolves the active SessionStart registration
for that same process owner on each call. It replaces the pinned IPC connection when the
observed generation changes, including A → B → A; it never guesses identity from cwd or
manually invents a registration. Concurrent Claude processes remain independent.

Old conversations are retired and late hooks, SessionEnd events, native-wake completions
and liveness probes cannot follow a newer generation. Already dispatched mutations are
never automatically replayed after a switch. `setup_status` now explicitly describes
stored connection configuration rather than promising a registered session.

## Added

An optional Linux/WSL maintainer feedback observer independently polls a feedback topic,
records triage and replies using a tool-disabled local Codex invocation. It retains its
queue and replay keys across restarts. It does not make code changes or deploy peer
requests. The qualified Codex fail-closed advisory is accepted without relaxing tool
restrictions. See [the operator guide](../../FEEDBACK_OBSERVER.md).

## Required client upgrade

The shared daemon compatibility contract is now 3. Update all kommutator client plugins
on a computer before restarting its daemon once. Local state schema 1 migrates to 2,
preserving identities, queued operations and delivery data; older daemons reject schema 2.
The hub and its database do not need upgrading. Keep the existing private client key and
configuration. Do not downgrade the daemon over the migrated local state.

Close the agent processes using kommutator, then run:

```sh
claude plugin marketplace update kommutator
claude plugin update kommutator@kommutator
```

If Codex is installed on the same computer, update it too:

```sh
codex plugin marketplace upgrade kommutator --json
codex plugin add kommutator@kommutator --json
```

For a default user-scope Claude installation, restart the daemon with the updated runtime:

```sh
"$HOME/.claude/plugins/cache/kommutator/kommutator/0.3.0/bin/manage" daemon restart
```

For a Codex-only installation use the installed plugin's
`0.3.0/bin/launch manage daemon restart` instead. Custom vendor configuration directories
use their corresponding plugin caches. Approve updated hooks normally. Resume the existing
conversation with `claude --resume <conversation-id>`; a new blank conversation is not
required. In that conversation, `whoami` must show its actual vendor conversation ID and
its own hub identity. Subsequent in-process switches use the same owner-generation mechanism.

## Validation and limits

See [implementation](implementation.md), [QA](qa.md), and [review](review-code-3.md).
The published 0.2.2 artifact reproduced the stale-ID defect in the new synthetic process
scenario. The final candidate passed the full release gate, including 386 workspace tests,
44 script tests, both plugin smokes and the expanded exported-plugin E2E. Source/credential
scans passed. The user authorized publication of the prepared tag and checksum-pinned assets.
See [published verification](publication.md). Download the assets from the [v0.3.0 release](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.3.0).

Live interactive Claude UI resume on the reporting computer, native wake after resume,
macOS packages, Windows reboot and full-day operation are not established by the synthetic
process tests. Linux x64/WSL is the qualified bundle target.
