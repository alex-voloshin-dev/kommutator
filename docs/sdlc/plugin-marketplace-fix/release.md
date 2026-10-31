---
type: release
feature: plugin-marketplace-fix
status: final
version: '0.2.1'
changelog:
  - 'Do not mistake plugin marketplace metadata for a legacy manual integration'
breaking: []
---

# kommutator 0.2.1 — marketplace conflict correction

## Fixed

Version 0.2.0 treated any JSON key named `kommutator` as a manual integration. Claude's
normal `extraKnownMarketplaces.kommutator` entry therefore blocked a configured client even
when no manual MCP server or hook existed. The correction inspects executable integration
sections instead of scanning all settings text. Keep the marketplace registration intact.

Actual manual MCP/hook conflicts remain blocked. Vendor configuration and trust are never
rewritten by conflict detection. No wire protocol or hub change is included.

## Update an existing installation

Inside Claude Code:

```text
/plugin marketplace update kommutator
/plugin update kommutator@kommutator
```

Restart the session after the update and trust changed hooks through Claude's normal workflow.
Ask for `setup_status`, then `whoami` and `list_sessions`. Existing hub/key configuration is
reused; do not remove `extraKnownMarketplaces` or re-enter the key in chat.

For Codex CLI, refresh the marketplace and reinstall the current plugin version:

```sh
codex plugin marketplace upgrade kommutator --json
codex plugin add kommutator@kommutator --json
```

Start a fresh independent session and approve hooks normally.

## Validation and limits

Execution evidence is recorded in [implementation](implementation.md) and
[published upgrade verification](publication.md). The regression must reach configured
`whoami` and message exchange with marketplace metadata present, not merely initialize MCP
or open setup. Native wake, desktop UI, other platforms and external physical LAN acceptance
remain outside this patch.
