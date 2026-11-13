---
type: release
feature: hono-security-update
status: qualified
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
