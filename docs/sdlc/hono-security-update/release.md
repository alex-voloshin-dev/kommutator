---
type: release
feature: hono-security-update
status: published
review_decision: proceed
version: 0.13.1
changelog:
  - "Security: update transitive Hono to 4.13.18 and @hono/node-server to 2.1.8 within existing MCP SDK dependency ranges."
breaking: []
---

# Kommutator 0.13.1 development preview

Updates the two affected transitive packages brought in by MCP SDK 1.32.2. No SDK,
application API, database schema, runtime contract or hook deadline changes are included.
The initial seven Dependabot alerts had patched floors 4.13.16 and 2.1.6; the selected
compatible patches also include later upstream corrections. The full candidate audit
reports no known advisories at any severity.

The hub and private setup use node:http, the hub upgrades use ws, and the MCP uses SDK
stdio. No affected Hono HTTP path was identified in supported application source. This
update removes affected dependency versions; it does not establish a fix for the reported
hub disconnects or timed-out operations. See [applicability](change-summary.md).

Independent correctness, security and external reviews approved the change. Ordered
build/typecheck and 647 workspace tests passed before the version bump; independent QA
passed 18 targeted MCP/setup process tests and both vendor clean-PATH export smokes.
Exact-version build/typecheck, all 647 workspace and 140 script tests, audit, packaging,
export integrity, clean-PATH and synthetic exported E2E passed on 0.13.1. Public installation
and rollout remain separate post-publication gates. No failed local qualification run occurred.
Source history scan found no secrets. Two export-scan findings were verified as generated
release metadata: all 193 payload hashes in each vendor manifest matched their files.

## Not validated

No native model conversation, additional target platform, day-long reliability, physical
subnet allow/deny or unattended Windows reboot acceptance is implied. Issues #9, #19,
#22 and #25 retain their recorded limits; successful repeats do not establish root causes.

## Publication and local deployment

Branch/PR/tag CI passed on release commit 2e64a1bd74be91509120af4326e47b467ceeb46c.
Exact assets were published and anonymous hashes verified before PR #27 catalog merge.
Real clean-profile Claude Code 2.1.323 and Codex CLI 0.167.2 installs launched MCP 0.13.1
with bundled Node 26.13.0 and passed private setup/origin rejection probes. Codex emitted
its temporary-home helper-alias warning; installation and MCP probes succeeded.
GitHub now reports all seven dependency alerts fixed; superseded PR #26 is closed.

Ordinary updater deployed hub/daemon 0.13.1 without manual recovery. Both backups and
live schema-4 daemon database passed quick_check with mode 0600. Hub healthy/connected,
caller active, outbox empty, checkpoint idle/applied 0.13.1, timer restored. Current chat
MCP remains compatible 0.13.0; no hot client update is claimed. The release was announced
in kommutator-feedback. See [rollout evidence](../../../spikes/evidence/2026-11-13-hono-security-rollout.json).
