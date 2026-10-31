---
type: onboarding
feature: repo-onboarding
status: final
date: '2026-10-25'
stacks:
  primary: typescript
  runtime: node24
  package_manager: pnpm@10.18.0
components:
  - packages/protocol
  - packages/hub
  - packages/agentd
  - packages/cli
  - plugins/claude-code
  - plugins/codex
  - spikes
  - docker
entry_points:
  - packages/hub/src/index.ts
  - packages/hub/src/server.ts
  - packages/agentd/src/index.ts
  - packages/cli/src/index.ts
conventions:
  - Strict TypeScript ESM with .js relative imports
  - Build before typecheck and tests because workspace exports point to dist
  - English artifacts and Russian conversation
  - Vendor observations in spikes/RESULTS.md; decisions in DESIGN section 19
risks:
  - Native delivery and hook behavior have no recorded live spike evidence
  - Session update and reincarnation semantics need an explicit contract
  - Reconnect catch-up and Stop filtering need sufficient delivery metadata
  - Two Claude sessions in one cwd need deterministic shim-to-hook binding
  - A minimal dashboard feed must precede the step 5 acceptance run
  - No Git history until the plan's step 5 gate passes
---

# Repository onboarding

Historical snapshot: use [ARCHITECTURE](../../ARCHITECTURE.md) and [ROADMAP](../../ROADMAP.md) for the current entry point. Counts and pending decisions below refer to their dated snapshots.

**Follow-up, 2026-10-25:** the user approved updated lifecycle, reconnect/wake, binding and
dashboard-order contracts. Steps 1–6 are now implemented and accepted; see the
[hub checkpoint](../m1-hub-conformance/implementation.md) and
[daemon/shim checkpoint](../m1-daemon-shim/implementation.md),
[dashboard checkpoint](../m1-dashboard/implementation.md) and
[live M1 checkpoint](../m1-live/implementation.md) for current code and checks.
The map and readiness table below preserve the initial onboarding baseline. In the updated
plan the dashboard is step 5, live E2E is step 6, and Git is step 8; the Git gate remains
successful live E2E. Claude 2.1.310 [spike evidence](../../../spikes/RESULTS.md) is recorded;
per-session bypass opt-in is approved and live production acceptance passed. Step 7
operability is implemented and checked; its full-day real-use criterion remains open. See
[operability evidence](../m1-operability/implementation.md). The requested next deployment
is a Docker hub in this WSL2 Ubuntu environment with WSL2/macOS clients (user correction;
the previous native Windows hub target was incorrect); use the
[transfer runbook](../../WINDOWS_LAN_SETUP.md). Native Windows clients remain unsupported. M2 Codex hook integration is now tracked in
[the M2 checkpoint](../m2-lan/implementation.md), separately from native desktop wake. Git and publishing remain step 8, with licensing subsequently resolved as MIT in the public preparation.

Observed on 2026-10-25. This handoff maps the initial scaffold and assesses execution
readiness; it does not implement M1 or certify native wake. Independent read-only agents
mapped the code and checked plan dependencies; their findings were checked against source.

## Start here

1. Read [shared agent instructions](../../../AGENTS.md).
2. Follow [MVP_PLAN](../../MVP_PLAN.md) for order and done criteria. Its immediate
   target is **M1: two Claude Code sessions on one Mac**. DESIGN §1 describes the broader
   cross-vendor/server scenario; DESIGN §17 places that in later milestones.
3. Consult [DESIGN](../../DESIGN.md) for behavior and [PROTOCOL](../../PROTOCOL.md) plus
   [protocol sources](../../../packages/protocol/src/index.ts) for the wire contract.
4. Use the [knowledge index](../../knowledge/MOC.md) for durable, source-linked notes.

The existing reviews remain closed historical inputs. The next work should be vendor
experiments and implementation, not another broad scaffold review.

## Components and entry points

| Component | What exists | What remains |
| --- | --- | --- |
| [Protocol](../../../packages/protocol/src/index.ts) | Zod records/methods, selected result schemas, identifiers/addresses, Unicode-safe header packing, protocol version 1 | Handler behavior and additional result contracts as needed |
| [Hub entry](../../../packages/hub/src/index.ts) / [server](../../../packages/hub/src/server.ts) | Runnable authenticated HTTP/WS server, snapshot, envelope validation and per-connection error handling | Domain RPC dispatch, routing, events/SSE |
| [SQLite](../../../packages/hub/src/db.ts) / [schema](../../../packages/hub/schema.sql) | Schema version 3, fresh initialization/refusal, uniqueness constraints, VACUUM INTO backup | Transactional domain mutations/replay |
| [agentd](../../../packages/agentd/src/index.ts) | Stub runDaemon, paths and adapter interface | IPC, registry, hub link, outbox, wake scheduler, lifecycle |
| [Claude adapter](../../../packages/agentd/src/adapters/claude.ts) | Socket transport, token auth line, conservative reply classifier, PID/socket probe | Verified message envelope/ACK meaning and daemon integration |
| [Codex](../../../packages/agentd/src/adapters/codex.ts) / [generic](../../../packages/agentd/src/adapters/generic.ts) | Pull-only adapters | Native Codex delivery is later work |
| [CLI](../../../packages/cli/src/index.ts) | citty command shape, paths, fail-open empty hook stub | MCP and operational commands; daemon run invokes a stub |
| [Dashboard](../../../packages/hub/public/index.html) | Static HTML and one session snapshot fetch | Live feed, delivery rendering, operational states |
| [Claude plugin](../../../plugins/claude-code/README.md) / [Codex assets](../../../plugins/codex/README.md) | Intended consumer MCP/hook/etiquette integration | Working kom commands and vendor verification |
| [Spikes](../../../spikes/README.md) | Experiment scripts 01/02/04/06, empty results template | Actual host observations |
| [Docker](../../../docker/Dockerfile) | Node 24 multistage hub build, frozen install and legacy deploy | Image execution was not checked in this onboarding |

The CLI binary is `kom` → `packages/cli/dist/index.js`; the standalone hub binary is
`kommutator-hub` → `packages/hub/dist/index.js`. `kom hub run` still exits as unimplemented.
Current unit/socket tests do not prove that one real agent can message another.

## Development setup

Created root [AGENTS.md](../../../AGENTS.md) and [CLAUDE.md](../../../CLAUDE.md). The latter
imports the former, keeping one set of project rules. Added a README entry point and
removed its immediate `git init` instruction to match MVP_PLAN step 7. No global agent
configuration, permissions, product MCP servers, or vendor hooks were installed.

Codex discovers project AGENTS.md instructions; without a detected project root it checks
the current directory, so start in this project root before Git is initialized.
[Official OpenAI documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
The Claude wrapper uses the documented `@path` import syntax.
[Claude Code memory documentation](https://code.claude.com/docs/en/memory#import-additional-files).
A fresh Codex/Claude session's instruction discovery was not launched as part of this task;
the files, import target and documentation were checked directly.

Use Node 24 and pnpm 10.18.0. Run `pnpm install --frozen-lockfile` when dependencies need
setup, then from the root:

```bash
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

The four packages use strict TypeScript/NodeNext ESM, tsup and Vitest. Relative imports
use `.js`; keep the `node:` prefix in builds. There is no lint/format script or CI workflow
in the inspected scaffold. The root `pnpm typecheck` already includes a build.

## Plan readiness

**Ready to begin steps 1–2.** The plan has a clear M1 target, useful done criteria, and
enough structure to start. Four bounded details need resolution at their implementation
boundary; the proposals below are not newly approved design contracts. Record the chosen
resolution in DESIGN §19, as the plan requests, and update schemas/docs/tests together.

| Item | Evidence and consequence | Smallest next action |
| --- | --- | --- |
| Session lifecycle | MVP_PLAN step 1 describes replay-or-insert only. DESIGN §3 requires same identity with a new incarnation on restart; §10 maps set_status to session.upsert. A literal insert-only handler cannot implement updates/restart. `sessions.reg_id` stores only the current registration. | In step 1 define create/replay, update-by-ID and reincarnate-by-ID separately, including late replay of an earlier registration. Test status/DND updates, lost registration ACK and restart. |
| Reconnect and Stop data | DESIGN §8 promises delivery resume; the current hello schema has no resume field and the plan specifies live deliver notifications. `MessageHeader` has priority but no hops/origin/force_wake, all needed by DESIGN §6. Reading a body through message.read changes its receipt. | In steps 1–2 define unread catch-up without marking read, plus sufficient metadata or hub-side wake filtering; implement it in steps 3–4. Test disconnect → send → reconnect without another send, and FYI/hops/DND filtering. |
| Claude shim/hook identity | PROTOCOL caller identity gives a shim PID/clientInfo and hook session ID/endpoint, but leaves their deterministic join implicit. Step 5 deliberately uses two sessions in the same cwd. | Extend spike evidence to the actual shim process/env facts and bind through a proven stable identifier or ancestry. Test both startup orders and identical cwd; never select the most recent session by cwd. |
| Dashboard ordering | Step 5 requires registration/send/deliver/read in the visible feed; step 6 implements the SSE-driven dashboard. The current HTML leaves the feed TODO. | Bring the minimal feed into step 1 or 4, before the E2E run. Leave fuller operational states and day-long use in step 6. |

Grounding: [MVP_PLAN steps 1–6](../../MVP_PLAN.md),
[DESIGN §§3, 6–10, 17](../../DESIGN.md),
[method schemas](../../../packages/protocol/src/schemas.ts),
[header schema](../../../packages/protocol/src/headers.ts),
[SQLite session schema](../../../packages/hub/schema.sql),
[current dashboard](../../../packages/hub/public/index.html).

The protocol package is implemented as a scaffold, not a complete response-schema catalog:
[results.ts](../../../packages/protocol/src/results.ts) currently covers inbox.list,
message.read, message.send, send.local and board.put. Define other response shapes when
the handlers and harness need them. This does not require a separate subsystem.

**Live gates remain open.** [RESULTS.md](../../../spikes/RESULTS.md) is blank. Before the
vendor-dependent parts of steps 3–4, record spikes 01/04/06 with versions: message line,
token/permission behavior, ACK meaning, real hook parent, Stop re-entry, detached survival.
Step 5 needs two actual Claude sessions and observed idle wake/reply. If native wake fails,
DESIGN §16 requires an explicit rescope; hook delivery cannot silently count as a pass.

No user clarification is needed to begin steps 1–2. The user will need to choose a license
before publication, and any acceptance-scope change after a failed native-wake spike must
be explicit. The estimate of 1.5–2k lines is planning guidance, not a completion criterion.

## Verification

| Check | Observed result on 2026-10-25 |
| --- | --- |
| Node / pnpm used | 24.19.0 / 10.18.0 |
| pnpm -r build | Passed, all four packages |
| pnpm -r typecheck | Passed, all four packages |
| pnpm -r test | Passed: protocol 28 + hub 13 + agentd 8 = 49; CLI has no tests |
| Initial sandbox test attempt | Unix socket listen EPERM; rerun with local socket permission passed |
| Knowledge vault | Six atomic notes, two themed MOCs, root MOC; validate_vault returned [] |
| Onboarding header | Checked with handoff.validate_header and load_artifact |
| Git | No .git; no init/commit/push, per plan |
| Live spikes / E2E / Docker | Not run; no claim of vendor compatibility or M1 acceptance |

The default shell exposed Node 26.9.0 and pnpm 11.18.0; pnpm version selection did not
complete promptly. Validation instead used the already available Codex Node 24 runtime
and cached pnpm 10.18.0 from the prior local review, through a command-local PATH. No
global toolchain settings or dependencies were installed or upgraded. A new environment
must provide the versions declared by `.nvmrc` and `package.json` rather than relying on
those machine-local caches.

## Knowledge map

- [Architecture map](../../knowledge/architecture-map.md)
- [Protocol and identity boundaries](../../knowledge/protocol-and-boundaries.md)
- [Hub storage and auth](../../knowledge/hub-storage-and-auth.md)
- [Toolchain and checks](../../knowledge/toolchain-and-checks.md)
- [Vendor evidence gates](../../knowledge/vendor-evidence-gates.md)
- [Shared agent workflow](../../knowledge/agent-workflow.md)

Refresh the relevant note and this implementation-status map as steps land. The source
code, accepted design decisions and recorded test/spike evidence remain authoritative.
