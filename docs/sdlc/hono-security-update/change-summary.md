# Hono transitive dependency security update

## Scope and assumptions

The maintainer's direct request is the implementation plan: replace the vulnerable
transitive packages without changing application behavior, public contracts, toolchain,
other dependencies or the SDK version. This is dependency hygiene, not a demonstrated
fix for availability issues #22 or #25.

On 2026-11-13, `pnpm view` reported Hono 4.13.18 and `@hono/node-server` 2.1.8 as
latest. Both fit the existing `@modelcontextprotocol/sdk` 1.32.2 ranges (`^4.11.4`
and `^1.19.9 || ^2.0.5`). The sole dependency change is `pnpm-lock.yaml`:
Hono 4.13.13 → 4.13.18 and node-server 2.1.5 → 2.1.8, including their integrity
hashes and snapshot references. No overrides or new direct dependencies are needed.

## Advisory applicability

The packages enter through the CLI's MCP SDK dependency. The CLI imports SDK
`server/mcp.js` and `server/stdio.js` in `packages/cli/src/mcp.ts`; it connects a
`StdioServerTransport`, not the SDK HTTP server. The hub's HTTP and upgrade paths
use `node:http` and `ws` in `packages/hub/src/server.ts`. The private setup form uses
`node:http` in `packages/cli/src/setup.ts`. No project source imports Hono or its
Node adapter. These source observations do not establish exploitability of these
advisories in the current supported paths, nor prove arbitrary future SDK usage safe.
Updating still removes affected versions from the distributed dependency graph.

| Advisory | Affected feature | Current path assessment |
| --- | --- | --- |
| [GHSA-46wx-v44x-9hh2](https://github.com/honojs/hono/security/advisories/GHSA-46wx-v44x-9hh2) | Hono CSRF middleware and hyperlink auditing | No Hono CSRF middleware used; private setup has its own Origin/token checks |
| [GHSA-4h7h-rv7c-7m2v](https://github.com/honojs/hono/security/advisories/GHSA-4h7h-rv7c-7m2v) | Hono form validator media-type recognition | No Hono form validator used |
| [GHSA-4m76-xfj5-7975](https://github.com/honojs/hono/security/advisories/GHSA-4m76-xfj5-7975) | Mounted path middleware | No Hono mounted routes used |
| [GHSA-h7mg-cq63-vhpq](https://github.com/honojs/hono/security/advisories/GHSA-h7mg-cq63-vhpq) | Hono wildcard middleware routing | No Hono router used for hub authorization |
| [GHSA-3gg2-335m-rxc6](https://github.com/honojs/hono/security/advisories/GHSA-3gg2-335m-rxc6) | Hono CSS interpolation | No Hono CSS helper used |
| [GHSA-qv5m-9pm6-hqp3](https://github.com/honojs/node-server/security/advisories/GHSA-qv5m-9pm6-hqp3) | Async upgrade socket reset | Hub upgrades use `ws`, not this adapter; this advisory does not explain the reported hub drops |
| [GHSA-jpvv-r467-5p4w](https://github.com/honojs/node-server/security/advisories/GHSA-jpvv-r467-5p4w) | Adapter request path normalization | Hub/setup request parsing does not use this adapter |

The original seven alerts name patched floors 4.13.16 and 2.1.6. Use the current
compatible patch releases instead: [Hono 4.13.18](https://github.com/honojs/hono/releases/tag/v4.13.18)
includes additional validator, body-limit, mount and static-path corrections;
[node-server 2.1.8](https://github.com/honojs/node-server/releases/tag/v2.1.8)
includes response-stream and disconnected-client fixes. These release notes are not
claims that Kommutator exercises those features.

## Validation

A fresh, isolated worktree installed the original lockfile with
`pnpm install --frozen-lockfile`; after the targeted update the same frozen install
passed again. Node 26.13.0 and pnpm 12.18.0 were used. Full `pnpm audit --json`
reported zero info, low, moderate, high and critical advisories at this observation.
No new tests are added solely to assert dependency versions: existing process tests
exercise the actual MCP stdio path and private setup, while hub suites cover HTTP/WS.
Ordered `pnpm -r build`, `pnpm -r typecheck` and `pnpm -r test` passed:
647 workspace tests (39 protocol, 176 hub, 167 agentd, 265 CLI). No gate failure
was observed in this implementation run.
Release packaging and independent review/QA are separate parent-workflow gates.
