# Marketplace metadata conflict correction

Observed 2026-10-31. The user's 0.2.0 client report identified a legitimate
`extraKnownMarketplaces.kommutator` entry being treated as a legacy manual integration.
A direct old-source probe and regression test reproduced this with no MCP server or hooks
in the settings. The earlier publication tested native installation and private form
availability; its synthetic configured-client fixture had omitted marketplace settings.
Those checks did not establish configured registration with a real installation's metadata.

## Change

The JSON detector now parses settings and examines actual `mcpServers` and executable
command hooks. It also checks the current project's MCP entries in `.claude.json`, without
blocking a session on another project's unrelated entries. Metadata and prompt hooks are
not commands. Invalid JSON/shapes and read failures remain redacted. Detection never edits
vendor settings or trust. Conservative Codex TOML matching is retained; this patch does not
introduce a general TOML parser or disable duplicate checks.

The patch version is 0.2.1. New immutable client archives and checksum pins replace the
catalog references; 0.2.0 release assets are retained. No live hub/client configuration is
changed by building or publishing this correction.

## Workflow and evidence

A software engineer implemented the fix in an isolated worktree, independent correctness
and security reviewers approved the final revision, and a separate QA engineer strengthened
and ran tests. See [review](review-code-2.md) and [release notes](release.md).

- Focused regression failed against the old implementation and passed after the fix.
- The strengthened configured E2E also ran against the exact preserved 0.2.0 export as a
  negative control: whoami failed with the reported false legacy-conflict error. The same
  scenario passes against 0.2.1.
- Unit cases cover real marketplace/enabled-plugin metadata, command hooks/MCP entries,
  current/other project state, malformed settings, redacted read errors, prompt hooks,
  quoted command paths, shell separators and preserved TOML manual cases.
- Exported E2E now includes marketplace settings before private-form setup, then configured
  status, fresh hooks, whoami and cross-vendor send/read/reply/topic/board operations.
  Injecting real manual MCP entries still rejects calls; removing only those test entries
  restores access while marketplace metadata remains.
- Engineer and final independent QA release gates passed: 354 workspace tests plus 29 script
  tests, frozen install, audit (zero known vulnerabilities), build/typecheck, source pin
  verification, fresh export integrity, clean-PATH MCP/setup, lifecycle and offline checks.
- An early engineer invocation ran unbuilt process tests; missing-dist failures in that
  diagnostic log are not regression evidence. Required build-first checks subsequently passed.
- One engineer run hit the unchanged 200 ms hook wall-clock threshold. The first independent
  QA run hit an existing cold manual-hook registration race. That fixture does not call
  pluginConflicts because no plugin profile is set. Focused lifecycle tests (3) and the final
  complete rerun passed; no timeout/assertion was changed. These observations are retained,
  not presented as a fix to those timing sensitivities.

## Boundaries

The configured acceptance uses a disposable hub and synthetic hook/MCP clients with real
packaged runtimes. It does not claim model-native wake, desktop UI, other architectures,
separate physical LAN clients, reboot or full-day acceptance. Published native CLI upgrade
and downloaded-runtime checks passed; see [publication evidence](publication.md).
