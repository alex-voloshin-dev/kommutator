# Published 0.2.1 regression verification

Observed 2026-10-31 with Claude Code 2.1.310 and Codex CLI 0.164.0 on Linux x64 / WSL2.
[Release v0.2.1](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.2.1)
contains new checksum-pinned client archives from source commit `1f81799`.
The 0.2.0 assets were not overwritten; their release notes point to the correction.

## Native update and installed runtime

The isolated profiles created during 0.2.0 publication were updated using the documented
vendor commands, retaining their existing marketplace registrations:

- Claude's marketplace update and plugin update returned success, explicitly reporting
  `oldVersion: 0.2.0` and `newVersion: 0.2.1`. Its settings still contained
  `extraKnownMarketplaces.kommutator` after the update.
- Codex marketplace upgrade and plugin add selected and installed version 0.2.1.
- The installed Claude MCP initialized and served setup. The installed Codex launcher
  downloaded its public pinned 0.2.1 runtime and did the same.
- The configured E2E harness was run against the actual downloaded/installed Claude ZIP
  and Codex runtime, not only a fresh local export. Marketplace metadata remained present
  through private form submission, configured status, fresh hooks, whoami and cross-vendor
  message/read/reply/topic/board operations. Injected genuine manual MCP entries still
  rejected calls, and recovery preserved marketplace metadata.
- Cache-removal survival, daemon restart and offline queued send also passed on those
  installed runtimes. The harness uses a disposable hub and synthetic hook/MCP clients;
  this is not a claim of a model-native or desktop UI conversation.

The preserved exact 0.2.0 export was a negative control: the same configured harness failed
at Claude whoami with the user's false legacy-conflict error. The 0.2.1 installed packages
passed that case. No production key or live configuration was used by these installation tests.

## Release gates

Independent final QA passed 354 workspace and 29 script tests. Correctness/security review,
source pin checks, build/typecheck and zero-known-vulnerability audit passed. Timing-sensitive
intermediate failures and unchanged reruns are documented in [implementation](implementation.md).
The bounded external CLI review produced no parseable result and was not counted as approval.

Source candidate and all five commits through the code release passed Gitleaks with the
existing narrow fixture allowances. Comparison against real local secret material found no
matches in source/history or the complete export. Artifact scanning reported two public
license-checksum false positives; each was recomputed from the bundled path-key MIT license.
No broad scanner exclusion or duplicate-check bypass was added.

Hosted source checks passed:

- [Main release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41239118038)
- [Main secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41239118004)
- [Tagged release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41239090249)

The existing hub and active vendor configuration were not changed. Users update their plugin,
restart the session and approve changed hooks normally; they should not delete marketplace
registration or paste their key into chat.
