---
type: tech-design
feature: reconnect-authority
status: draft
review_decision: proceed
decisions:
  - "ADR 001: Versioned process birth and explicit legacy transition"
  - "ADR 002: Minimal durable SessionStart authority before delivery"
  - "ADR 003: Confirm shutdown after transport closure"
  - "ADR 004: One absolute lazy-start connection deadline"
components:
  - "Agentd process probes, registry lifecycle fencing and Claude retirement adapter"
  - "CLI hook authority, private generation journal and MCP registration resolver"
  - "Local IPC compatibility contract and daemon management client"
risks:
  - "Legacy process birth has no timezone provenance; retain unknown records rather than infer equivalence"
  - "A hook terminated before durable authority publication cannot be recovered from MCP hints"
  - "Portable ps fallback has second resolution and requires separate platform evidence"
  - "Mixed runtimes require explicit compatibility fencing and restart"
---

# Reconnect authority and process identity

## Inputs and assumed goals

No PRD exists. This design derives from the user's restart/reconnect report, the repository's identity and latency constraints, and source at the 0.14.0 baseline. Assumed goals are (1) make process identity independent of caller timezone on Linux, (2) preserve genuine SessionStart authority across interrupted delivery, (3) retain history and replay safety across an upgrade, (4) distinguish an interrupted shutdown reply from proven daemon absence, and (5) let a first MCP connection use its declared startup budget. This is a proposed design awaiting independent review and deterministic baseline/candidate tests, not a claim that the user's entire incident has been reproduced or fixed.

Read inputs include ARCHITECTURE, ROADMAP, DESIGN §19, PROTOCOL caller identity, MVP step 4, and knowledge notes `protocol-and-boundaries`, `codex-root-identity`, and `operability-evidence`.

## Established source facts and evidence limits

`agentd/src/process.ts` obtains untagged `ps -o lstart=` text under inherited timezone and locale, with a 1,000 ms subprocess timeout. The birth investigator observed the same PID produce `Fri Nov 13 15:53:13 2026` under UTC and `Fri Nov 13 10:53:13 2026` under America/New_York while Linux stat field 22 remained `26229004`. This demonstrates identity instability, not a complete vendor restart reproduction.

`cli/src/index.ts` starts the unchanged 140 ms hook deadline before authority-module import. `saveClaudeRegistration` then awaits the birth subprocess, directory creation, legacy lookup, generation listing, temporary-file write and hard-link publication. It writes the legacy alias before returning. Killing the hook before the link leaves no committed authority; an already-created empty directory deliberately prevents legacy fallback. MCP resolves the journal before preparing agentd and cannot invent the missing authority. A complete linked generation already supports exact-authority replay when later delivery fails.

Qualification correction: the initial delayed-ps/delayed-link process probe used stale 0.12.3 dist and is not 0.14.0 evidence. The verified retained 0.14.0 artifact rerun (commit `63ffa4bd5ed7213c1b706511e60ea7d3b2c04033`) confirmed normal publication at 142 ms, no journal after delayed ps at 187 ms, and an empty journal plus temporary file after delayed link at 191 ms. All hooks exited zero with empty output. See `reproduction.md`; these controlled delays establish mechanisms, not the reporter's exact live trigger.

The shutdown helper accepts reset and daemon-stopping errors as uncertain transitions, but the IPC socket close handler emits an uncoded `IpcError`. The source-bundled isolated shutdown reproduction confirmed one acknowledged shutdown, ordinary socket closure during the fresh status RPC, immediate confirmation failure at 9 ms, and ENOENT on an independent subsequent probe. This proves a client/confirmation mismatch, separately from the authority and startup failures; see `reproduction.md`.

The reconnect investigator also reproduced a distinct lazy-start failure with the real baseline IPC client, a 5,000 ms request budget and an isolated listener appearing after 2,200 ms. The first call failed at 1,761 ms; a second call succeeded at 2,211 ms, with one daemon spawn. See the companion `reproduction.md` for retained controls. Registration authority alone does not fix this connection-budget defect.

## Decisions and component boundaries

### 1. Versioned birth evidence

On Linux, read `/proc/sys/kernel/random/boot_id` and `/proc/<pid>/stat` without spawning a process. Return an opaque `linux-v1:<boot-id>:<start-ticks>` token; keep PID separate. Parse stat fields after the final closing parenthesis, validate field 22 as a nonnegative decimal string, and never round ticks through JavaScript Number. Do not cache a PID's birth. Failure returns unavailable, not an alternate identity format. Boot identity may be cached for the process lifetime. Recheck owner identity at existing asynchronous boundaries.

On other currently supported POSIX platforms, use an explicitly tagged `ps-utc-v1` result with `TZ=UTC` and `LC_ALL=C`. This preserves the existing weaker second-resolution birth model; it is not evidence of Linux-equivalent precision or executed macOS qualification. No unsupported platform silently receives a fabricated identity. An unavailable probe plus non-ESRCH existence check remains unknown.

Birth comparison becomes a three-way operation: same, proven different within a supported comparable format, or unverified. A legacy string versus a new tagged token is unverified, never proof of PID reuse. This rule applies to startup/sweeps, IPC pinning, prior-owner resume, native delivery, operation ownership and private journal selection.

### 2. Upgrade without mass retirement or inferred timezone conversion

Persisted legacy rows and generation journals remain intact. Startup must not mark all rows gone merely because the representation changed, reset generations, rewrite replay keys, or discard pending work. There is no safe universal conversion from the old untagged local-time string. Do not guess timezone offsets, accept PID equality as historical birth equality, or search arbitrary contexts by cwd.

Client activation is per owner: upgrade that client's MCP and all lifecycle hooks, exit its old process, then launch a **new OS process** with updated trusted hooks against the compatible daemon. Service activation may leave unrelated old clients alive but unavailable; it does not require a host-wide process shutdown. Hot migration of a legacy owner in the same live PID is unsupported and rejected. The new process can adopt a unique legacy predecessor's history only when the old PID is positively proven absent and vendor conversation, cwd and project match. An unavailable old-process probe, the same PID, ambiguous history or an incomparable birth is insufficient. Preserve unknown legacy rows rather than marking them all gone. If safe adoption is unavailable, fail explicitly or create a distinct identity under the existing duplicate-owner rules; never infer ownership from cwd alone.

Use existing prior-owner resume ordering and lifecycle fences for an eligible dead predecessor. Preserve name, role, topic memberships, receipts, deliveries, replay keys and outbox; reset launch-specific delivery policy and invalidate old peers/native continuations. Persist the new stable process birth and lifecycle epoch. Already-gone records are never revived by a sweep or format conversion; adoption requires a genuine new registration and the same positive old-owner death proof. Preserve legacy journals and tombstones. Never copy subscriptions to an ambiguous or unrelated owner. No new epoch/event protocol, second intent journal or deferred worker is introduced.

Bundled plugin MCP replay still requires the exact committed positive-generation SessionStart journal. Updated manual hooks remain supported through their direct observed `client: hook` hello and verified current owner, with absent owner generation (conceptual generation zero); they are not required to manufacture a plugin journal. Both routes require the coordinated new-process activation and positive predecessor death for legacy adoption. Include a schema-4 manual-hook upgrade regression proving history retention after the old owner has exited.

This is a local registry schema and client-runtime contract change. Increment the local state schema from 4 to 5 and the daemon compatibility contract from 3 to 4; keep hub schema and hub protocol unchanged. Upgraded clients require a compatible daemon before replay. Add local `ipc.hello.runtime_contract` as an optional positive integer in the shared executable hello schema, and require its exact value **4** whenever `vendor: claude-code` and `client: hook` or `shim` requests session binding. Reject missing, older and newer unsupported values before registration or owner selection, with explicit incompatible-runtime guidance. This applies equally to manual hooks with absent owner generation and bundled positive-generation hooks/shims. Owner-local management `client: cli` and non-Claude bindings retain their existing compatibility rules; this field is not forwarded to the hub. Update all supported Claude hello constructors and PROTOCOL together. Crucially, IPC rejection cannot stop an old SessionEnd hook writing a legacy-path marker before IPC. Therefore mixed lifecycle hooks within a reconnecting owner and hot downgrade are unsupported: finish updating that owner's wiring before its fresh process starts. An unrelated old process may remain disconnected because old binding rejection, same-live-PID migration refusal and suppression of native delivery to unverified owners prevent it from acquiring or exercising new authority. Its legacy-path end marker cannot retire another PID/birth's new journal. Do not claim the contract number alone bridges retirement namespaces. Older daemons must refuse the new state schema. Migration tests cover both directions of version skew plus per-owner coordinated activation.

Service rollout follows the concrete transition procedure in `docs/LOCAL_RELEASE_DEPLOY.md`: briefly pause/drain the updater for the first contract transition, retain backups and checkpoint, qualify/publish assets and catalogs, then deploy under existing service-restart authorization. Verify the exact expected daemon contract and report service health separately from each client's readiness. Updating service processes does not update vendor wiring or prove loaded MCP recovery. An automatic updater may resume after service qualification even while unrelated old clients await individual restart. No schema-5 rollback is automatic.

### 3. Recoverable authority handoff within the existing deadline

Keep the existing atomic immutable-generation publication as the single durable authority boundary. After bounded hook input is validated, use synchronous Linux proc reads and a minimal synchronous filesystem publication section (directory, bounded validation/listing, exclusive temporary write, immutable hard link, cleanup), without yielding to the JavaScript event loop before commit. Publish the complete versioned start event before delivery imports, daemon probes, diagnostics, or legacy compatibility alias writes. Remove legacy alias completion from the critical success path for upgraded readers; replay and SessionEnd consume the same committed journal. Retain the 10,000 generation limit, bound file sizes before reading/parsing and retain the bounded collision retry count. Avoid a second uncoordinated authority store or scanning temporary files as authority.

The durable record retains the existing fields: exact owner PID/tagged birth, positive generation, vendor session, cwd/project and observed launch facts. Generation ordering remains monotonic within that owner birth; exclusive publication collisions retry within the existing bounded loop. Keep private directories at 0700 and temporary/committed records at 0600. The highest incomplete, malformed or ended journal state fences fallback. After SessionEnd captures a birth and generation, delayed completion marks only that captured authority and cannot retire a newer A → B → A generation. Before capture, a vendor payload containing only session ID cannot distinguish an old A end from a new A after A → B → A; this pre-capture ambiguity remains a vendor limitation and is not claimed fixed. The adapter's durable-marker probe uses the same birth selector as the writer. Revalidate current journal and process after asynchronous work and before binding or returning owner-specific results.

After publication, a killed delivery phase is recoverable through MCP replay of that exact event; after a successful alias write but before daemon acceptance the same rule holds. No MCP mutation is resubmitted across an owner change. Before any durable event exists, there is no safe recovery authority: return the existing actionable fresh-SessionStart guidance. Removing the asynchronous critical path repairs the reproduced external-ps and async-link scheduling delays; it cannot guarantee progress through arbitrary blocked kernel storage, stdin or OS scheduling. Candidate controls must show those obsolete subprocess/async-link paths are not invoked and the authority is actually published, not merely suppress the failure injection. Pre-publication process termination still leaves safely unavailable authority. A separate durable launcher intake would require its own reviewed ordering/end protocol if stronger guarantees become a requirement.

Keep the 140 ms entrypoint timer, 90 ms IPC timeout, empty stdout/exit 0 failure behavior, temporary 300 ms process gate and 200 ms target. Synchronous bounded local work prevents timer interleaving during commit, but a blocked kernel call also prevents that timer firing. This is a deliberate trade-off, not a strict wall-clock guarantee: reject oversized journal inputs, retain full-process latency tests, and do not claim protection against filesystem hangs. The portable subprocess path remains separately bounded and qualified.

### 4. Shutdown confirmation

Give unexpected IPC transport closure a stable error code distinct from deliberate local client close. In daemon-stop confirmation only, classify that closure alongside reset/stopping as uncertainty and continue fresh non-starting management probes under the existing two-second total deadline. Send shutdown once. Only ENOENT/ECONNREFUSED on a fresh probe authorizes replacement. A close, timeout, PID alone, successful write or exhausted deadline does not. Preserve mutation uncertainty wording and never retry session mutations because their connection closed.

### 5. Lazy-start connection budget

Replace the fixed startup retry-count ceiling with one monotonic absolute deadline derived from the caller's existing timeout. Every connection attempt, readiness wait and hello consumes the remaining budget; neither a new attempt nor a delayed spawn resets it. Spawn at most once per shared startup attempt. Honor explicit close/cancellation during waits and before connecting. Only retry failure to establish the connection/hello; never replay an application RPC already dispatched. Calls with lazy start disabled and the 90 ms hook budget retain those limits. Existing immutable owner checks still run before dispatch after a slow startup. The 5,000 ms MCP budget must permit the reproduced 2,200 ms listener without requiring a second model call.

## Acceptance and negative controls

| Goal or risk | Required deterministic evidence |
| --- | --- |
| Timezone identity | Same live PID under UTC and America/New_York differs on baseline and agrees on candidate; changed start ticks/boot ID differs; unusual stat comm parses correctly |
| Linux subprocess delay | Baseline hook with delayed ps misses authority; candidate uses proc and publishes without invoking ps; single attempt under unchanged hook budgets |
| Interrupted delivery | Kill/delay immediately after immutable publication; fresh MCP replays exact committed authority, registers current owner and does not use inherited ID |
| Pre-publication interruption | Terminate before link or truncate input; no fabricated authority or temporary-file adoption; recovery guidance remains honest. Separately measure synchronous commit latency and state blocked-kernel limitation |
| End and replacement fences | After capture, delayed SessionEnd, concurrent newer start and A → B → A cannot retire successor; other PID, PID reuse and old async completions cannot rebind. Record pre-capture same-ID ambiguity as an unresolved vendor limit |
| Legacy upgrade | Real schema-4 fixtures retain data/outbox/tombstones; untagged births become unverified, not mass gone; same-live-PID adoption rejects; new-process registration adopts unique history and topic memberships only after positive old-PID exit, including manual generation-zero hooks; ambiguous history stays separate with no subscription copying |
| Mixed runtimes | Old daemon rejects new state; new client rejects old contract; old binding clients reject; per-owner full hook/MCP upgrade then new process works while unrelated legacy owners remain disconnected and receive no native delivery. Mixed lifecycle hooks within one owner/hot downgrade are unsupported |
| Codex boundary | Per-call root IDs remain required, fork calls rejected, inherited IDs ignored; no Claude migration rule creates a Codex root |
| Shutdown close | Normal-close negative control fails baseline; candidate confirms fresh absence once; live listener/timeout still prevents replacement; shutdown is sent once |
| First lazy start | Baseline first call fails for 2,200 ms delayed listener despite 5,000 ms budget; candidate first call succeeds with one spawn. Beyond-budget listener fails; cancellation and close stop attempts; no dispatched mutation is replayed |
| Existing reliability | Build, typecheck, tests in repository order; release:check for packaging, unchanged receipt/wake/replay tests and exact installed-runtime evidence before release claims |

Require tests that fail against the baseline for the claimed repaired trigger, rather than only testing the new helper. Parent workflow records versions, command output and failures. No test or vendor reproduction was run by the architect. Keep historical #9/#19/#22/#25 investigation limits and day-long, independent-subnet, reboot and macOS execution gates open.

## Risks and mitigations

- Upgrade requires coordinated hook/MCP wiring and a new process. Reject same-live-PID legacy adoption and use existing resume logic only after positive old-owner exit; retain data and unknown records rather than shipping a blind global replacement.
- Filesystem or scheduler stalls before publication still lose a hook opportunity, and blocked synchronous I/O delays timer execution. Bound inspected data and retry loops, retain measured full-process gates and explicit unavailable status; distinguish this from recoverable post-publication interruption in tests and release notes.
- Fixed UTC ps fallback has weak granularity. Preserve conservative unknown handling and require actual platform testing; stronger native macOS birth evidence is deferred, not implied.
- Compatibility fences can require a real daemon/client restart. Report loaded versions and unavailable owner state separately from healthy global connectivity; no automatic service restart or global resurrection.
- Native policy and receipts are unrelated to identity success. Keep inbound accept opt-in, socket delivery separate from read evidence, and all existing DND, hop, Stop and trailing-wake guards.

Before implementing behavior, record the accepted recovery/migration contract in DESIGN §19 and align PROTOCOL plus executable local schemas. The two-lens second review approved this design; the review-decision gate returned `proceed`. Implementation and candidate validation remain subsequent work.
