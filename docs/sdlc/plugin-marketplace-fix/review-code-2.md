---
type: review
target: plugin-marketplace-fix
iteration: 2
verdict: approve
findings: []
---

# Conflict detector correction review

Independent correctness/integration and security reviewers approved the final implementation.
JSON inspection is limited to executable MCP/command-hook sections and current-project
Claude MCP state. Marketplace/plugin/permission metadata is not treated as an integration.
Read/parse failures remain fixed and redacted, and no vendor files are rewritten.

Review caught regressions in a draft TOML scanner involving comments and multiline command
arguments. That scanner was removed; the final patch preserves conservative legacy TOML
matching and tests those manual-integration cases. No broad duplicate-check bypass shipped.

The configured exported-client scenario now submits the private form, starts fresh hooks,
registers through whoami and exchanges messages with marketplace metadata present. It also
injects actual manual MCP definitions and checks rejection and recovery. Archive hashes,
versions, layout and executable bits were checked against the generated source pins.

Final independent QA passed 354 workspace and 29 script tests. An external CLI lens was
attempted separately; a missing parseable result is not counted as review approval.
See [implementation](implementation.md) for the regression and timing-test evidence.
