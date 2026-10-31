# Public source preparation

Completed 2026-10-29 against the [publication-readiness review](../public-repository-review/review.md).
The user approved applying its recommendations, including MIT. Copyright attribution uses
“2026 kommutator contributors”; no third-party license was replaced. This is source and
local-artifact preparation, not a public release or a change to the running installation.

## Changes and resolution

| Review | Resolution |
| --- | --- |
| R1 | Root MIT LICENSE and SPDX metadata; standalone plugin roots and runtime payloads include it alongside Node/dependency notices |
| R2 | INSTALL creates private key/data before Compose; create-only key install has explicit failure checks, actual UID/GID and fixed loopback 8787 |
| R3 | README capability/evidence matrix distinguishes native wake, hooks, pull behavior and unqualified targets |
| R4 | pnpm release:check and Linux x64 GitHub workflow cover frozen install, build/types/tests, export, checksums/licenses, smoke and synthetic E2E |
| R5 | Five Russian review artifacts replaced by distinct English historical summaries; Unicode test fixtures retained |
| R6 | Personal paths/endpoints and raw conversations/trust inventories curated; 17 evidence JSON files mark public redaction; one private-path screenshot withheld |
| R7 | Current ARCHITECTURE/ROADMAP and portable contributor rules replace historical onboarding as the primary path |
| R8 | INSTALL and PLUGIN_BUILD are public entry points; manual integration is an explicit advanced alternative |
| R9 | Git exclusions cover known key, environment, SQLite and generated-output formats |
| R10 | Docker context excludes .artifacts |
| R11 | Root package version 0.1.0 drives generated release constant, workspace/source-plugin/export manifests and runtime diagnostics; pnpm version:sync updates derivatives |
| R12 | README and SECURITY explain one shared trust domain, unencrypted LAN scope and conditional private reporting route |

Original source, documentation and raw evidence were copied to a permission-restricted
private archive outside the checkout before editing. Public evidence remains explicit
about redaction and historical scope. No original is represented as newly executed data.
The source-transfer checkout used an isolated snapshot rather than creating Git history;
reviewed changes were integrated only after checks. Dependencies and pnpm-lock.yaml did
not change. The service, firewall, shared keys and installed vendor configuration were not
modified by this work.

## Verification

- Independent implementation and QA runs of the complete release gate passed.
- Workspace tests: 324 (protocol 30, hub 141, agentd 50, CLI 103).
- Release verifier: six tests, including tampered/unlisted files, wrong license, stale
  release/content identity, missing dependency notices and malformed/duplicate checksums.
- Fresh exported plugins passed full inventory/license/content-identity verification,
  clean-PATH setup smoke and synthetic messaging/lifecycle/offline-queue E2E.
- Final INSTALL snippet passed normal/repeated/eight concurrent setup, partial-output
  generator failure, mktemp failure, empty/symlink rejection, 0700/0600 permissions and
  isolated Compose configuration resolution. No real service was started by these checks.
- Public Markdown passed English and local-file-link checks; all 17 curated evidence JSON
  files parsed and identified their redaction. Unicode behavior fixtures remain unchanged.
- Candidate source inventory excluded generated/runtime files; ten ignore probes passed.
  High-confidence private-key/token pattern searches found no match. This is a bounded
  inspection, not proof that every possible secret or dependency issue is absent.
- Final review is [approve](review-code-2.md). The optional external review returned no
  parseable result and is not counted as approval.

The workflow uses official [checkout v4](https://github.com/actions/checkout/tree/v4) and
[setup-node v4](https://github.com/actions/setup-node/tree/v4) interfaces, with read-only
repository permissions and no publishing step. Its local command was exercised; hosted
GitHub Actions has not run because this task did not publish the repository.

## Remaining boundaries

Linux x64 is the qualified local artifact target. Real conversation after migrating the
manual installation, other platform bundles, Copilot, desktop/native wake, reboot, external
allowed/denied-subnet checks and day-long use remain separate acceptance work. Dependency
CVE and comprehensive transitive-license audits were not added or claimed. No Git commit,
remote push, npm publication or public marketplace registration was performed.
