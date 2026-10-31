---
type: release
feature: claude-session-identity
status: final
version: '0.2.2'
changelog:
  - 'Isolate concurrent Claude process owners and standardize whoami'
breaking: []
---

# kommutator 0.2.2 — independent Claude session identities

## Fixed

Two live Claude processes could share a vendor conversation ID and overwrite one
hub identity, status and inbox. The client now binds each process owner separately,
using the vendor ID plus observed PID and process birth. The hub assigns unique
handles atomically. The original vendor ID remains visible for diagnostics.

Delayed requests and liveness checks cannot follow or terminate a replacement
owner. Hook-only sessions remain alive without a native messaging socket. If two
owners share one native endpoint, delivery stays in their isolated hook/MCP inboxes.

Claude and Codex now share a `whoami` presentation template with complete hub and
vendor IDs, incarnation, project, topics, state, wake policy and capability.

## Upgrade: one local daemon restart is required

The internal client/daemon compatibility contract changed to 2. Update every
kommutator client plugin on the computer before restarting its shared daemon.
Old plugin clients cannot use the new daemon, and new clients refuse the old one.
No hub update, database migration or new connection key is required.

1. Close agent sessions using kommutator on that computer.
2. In a terminal, update the Claude installation:

   ```sh
   claude plugin marketplace update kommutator
   claude plugin update kommutator@kommutator
   ```

   If Codex is also installed, update it too:

   ```sh
   codex plugin marketplace upgrade kommutator --json
   codex plugin add kommutator@kommutator --json
   ```

3. Restart the shared daemon once. For a default user-scope Claude installation:

   ```sh
   "$HOME/.claude/plugins/cache/kommutator/kommutator/0.2.2/bin/manage" daemon restart
   ```

   For a Codex-only installation, use:

   ```sh
   "$HOME/.codex/plugins/cache/kommutator/kommutator/0.2.2/bin/launch" manage daemon restart
   ```

   Custom vendor configuration directories use the corresponding plugin cache
   under that directory. Keep the existing private kommutator configuration.

4. Reopen the sessions and trust the updated hooks normally. Ask each for `whoami`.
   Their **hub session IDs and handles must differ**, even if the vendor IDs match.
   Set different statuses and check that each session keeps its own status.

## Validation

[QA evidence](qa.md) records 372 workspace tests, 29 script tests, clean-PATH plugin
smokes and the exported-plugin end-to-end scenario. Two separate synthetic vendor
processes with one vendor ID retain independent statuses and inboxes, survive a
full daemon sweep, and remain isolated when one exits. The same scenario reproduced
the identical-ID defect in the published 0.2.1 artifact. Dependency audit, build,
typecheck, integrity checks and source/credential scans passed; two artifact scanner
matches were verified as license checksums. Both correctness and security reviews
approved the final change.

[Published upgrade verification](publication.md) records successful Claude/Codex CLI
updates from 0.2.1, installed-runtime E2E, and the actual contract-1 to contract-2 daemon
restart with configuration and persisted database records preserved.

## Not validated

These are synthetic process-level checks, not a live Claude application test on
the user's second machine. Native wake for duplicated resumed conversations,
macOS release bundles, desktop UI, reboot, external physical LAN rejection and
full-day operation remain separate acceptance gates. Existing Linux x64/WSL client
qualification applies; the running hub is unchanged.
