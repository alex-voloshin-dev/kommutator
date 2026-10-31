# GitHub client plugin installation

## Scope and assumptions

The user requested a working GitHub installation for Claude and Codex clients, following the
published-source milestone. This direct implementation request is the develop workflow input;
no separate plan artifact was required. Linux x64 / WSL2 is the existing qualified bundle
target. Native Windows and other architectures are not silently claimed supported.

The same bundled runtime, private setup form, MCP tools, hooks and skills are preserved.
Claude installs a complete checksum-pinned ZIP using its native marketplace archive source
(requires Claude Code 2.1.224+). Codex installs a lightweight source plugin that retrieves its
fixed, source-pinned tarball on first MCP startup, outside the hook path. The catalogs use
`kommutator`; extracted offline bundles retain `kommutator-local`.

## Workflow and review

Implementation was isolated in a Git worktree. One software-engineer implemented the
packaging, a separate correctness/integration reviewer and security reviewer inspected the
diff and exact archives, and an independent QA engineer exercised the result. See
[final review](review-code-2.md). The initial Claude startup timeout finding was fixed by
moving its download to the native installer; no hook deadline was relaxed.

The initial implementation gate observed an existing CLI elapsed-time check at 201.4 ms
against the unchanged 200 ms threshold. A focused rerun and the next full gate passed.
No assertion or timeout was weakened. The final independent QA gate passed: 328 workspace tests and 29 script tests, including
new space-containing-path and FIFO-lock regressions. Frozen install, audit (zero known
vulnerabilities), build/typecheck, hosted source identity verification, fresh export integrity,
clean-PATH MCP/private setup/cache-removal for both vendors, and synthetic cross-vendor
message/reply/topic/board/offline/restart checks passed. Actual Codex CLI installed the local
catalog in an isolated home; Claude CLI accepted the catalog. The public download/native
Claude archive installation is checked after publication and recorded separately.

The external CLI reviewer attempt exceeded its 50-second bound without parseable output;
it is skipped, not counted as approval. Independent internal reviewers and QA supplied the gates.

## Evidence boundaries

Local bundle synthetic tests do not establish desktop UI, native wake, a different physical
LAN host, reboot, capacity, or full-day acceptance. Installation tests use isolated vendor
homes, not the developer's active configuration. The live Docker hub and installed manual
clients are not upgraded by this publication.

## Official source references

- [Claude marketplace archive schema](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [Claude MCP startup timeout](https://code.claude.com/docs/en/env-vars)
- [OpenAI Git-backed plugin packaging](https://developers.openai.com/plugins/build/plugins)
