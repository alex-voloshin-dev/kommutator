---
type: release
feature: runtime-toolchain-refresh
status: approved
version: 0.12.0
changelog:
  - "Changed: move source builds and bundled Linux x64 clients to Node 26.13.0 and pnpm 12.18.0."
  - "Changed: refresh ws, citty, Vitest and TypeScript while retaining the TypeScript compiler API required for declarations."
  - "Fixed: capture early Claude hook authority and provide compact MCP feedback tools."
breaking:
  - "Source and operator workflows require the new runtime and package manager; refresh old updater prerequisites before deployment."
  - "Compact MCP feedback outputs replace prior verbose result shapes."
---

# kommutator 0.12.0 development preview

The version follows the pre-1.0 breaking-change rule from the changes since v0.11.0.
This is the approved release proposal at candidate freeze; publication and deployment
are recorded separately against the immutable source revision and asset hashes.

## Changed

- Source builds, bundled clients and the Docker hub use Node 26.13.0. pnpm 12.18.0 has
  explicit esbuild-only lifecycle approval; types match Node 26.
- ws 8.22.2, citty 0.2.2, Vitest 5.1.0 and TypeScript 7.0.2 are used. Declaration
  generation retains the official TypeScript 6 compiler-API compatibility package.
- The optional operator updater has an explicit cutover mode requiring both release version
  and commit. It verifies catalog-pinned archives and actual runtimes before activation.
- Bundled runtime metadata separates Node26 payloads and validates cached content before
  MCP/manage startup. Hooks remain offline with their existing budget.

## Fixed

- Early Claude SessionStart authority survives delayed loading; stale generation metadata
  cannot silently attach a different conversation.
- MCP message tools offer compact results and bounded safe diagnostic hints. Feedback
  import reports why a candidate was excluded.
- The production Docker image includes the project license.

## Validation at candidate preparation

Ordered build/typecheck and all 520 workspace tests passed, followed by the complete Linux
x64 release check: 134 script tests, audit, export checksums/licenses, clean-PATH plugin
smoke and synthetic cross-vendor E2E. Independent correctness/security review, external
review and QA passed. An initial hook observation timing failure passed isolated and full
repeats without changing assertions or deadlines.

## Not validated yet

Fresh frozen-candidate checkout, retained-archive, container and updater cutover
qualification are separate R3 gates; consult the versioned execution evidence. Real vendor installation, other platforms, physical-subnet clients, Work
desktop/native idle wake, day-long use and Windows reboot remain separate evidence gates.
