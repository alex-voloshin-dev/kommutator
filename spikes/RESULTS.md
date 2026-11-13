# Spike results

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

Initial live run: **2026-10-25**, following [M1_LIVE_RUNBOOK.md](M1_LIVE_RUNBOOK.md).
Sanitized observations: [evidence JSON](evidence/2026-10-25-claude-2.1.310.json).
The later authorized bypass opt-in experiment is recorded separately below and in its
[follow-up evidence JSON](evidence/2026-10-25-claude-2.1.310-bypass-optin.json).

- macOS **27.0.1**, build **26A434**; Node **24.19.0**; Claude Code **2.1.310**.
  The initial read-only preflight saw 2.1.280; the user upgraded before any live session.
  All live results below are from 2.1.310. The UI selected Opus 5.5.
- Used interactive PTYs on this Mac, recorded with `/usr/bin/script`, because Terminal
  app UI control was unavailable. Hook ancestry therefore includes `script` above Claude.
- Initial-run targets used the same disposable project `/private/tmp/kommutator-m1.p18zrn`,
  private local hooks, and `umask 077`. No production plugin or working repository was
  loaded into the targets. Session captures were mode `0600`; no tokens are in this report.
- Common launch flags: `--setting-sources local --strict-mcp-config`.
  Messaging/Stop targets used `--mcp-config '{"mcpServers":{}}' --tools ''`.
  Manual targets used `--permission-mode manual`; the bypass target used
  `--dangerously-skip-permissions`. Detached used `--tools Bash`; MCP targets used only
  the temporary `spike01-env` config and `--tools ''`.
- The runbook's two-session MCP section was added during this run. It was read and
  executed after spike 06, with its updated capture containing PID/PPID/cwd.
- The UI reported a rejected Remote Control login in the experimental sessions. Local
  Claude API responses worked; no login or Remote Control settings were changed.

**Outcome:** manual native wake and MCP identity confirmed; bypass/default **Held**.
The follow-up confirmed native wake with an explicit per-session `crossSessionInbound: accept`
opt-in, including immediate half-close. Claude Stop passed. Detached
**Bash-tool descendant** survival passed. The later production check below also confirms
real MCP-spawned daemon survival. The subsequent [M1 run](#m1-run--production-two-session-acceptance)
passed full two-session production acceptance.

## 01 — Claude Code inbox socket

### Hook and transport facts

`/hooks` showed three local command hooks on two events. The exec-form shell probe's
parent `comm` was `/Users/REDACTED/.local/bin/claude` in all six sessions; its
grandparent was `/usr/bin/script`. Examples:

| Target | Probe PID | Parent Claude PID | Grandparent PID |
| --- | ---: | ---: | ---: |
| manual messaging | 82478 | 82464 | 82461 |
| bypass messaging | 83271 | 83219 | 83216 |
| Stop | 83670 | 83659 | 83656 |
| detached | 84262 | 84253 | 84250 |
| MCP A | 84467 | 84457 | 84454 |
| MCP B | 84522 | 84512 | 84509 |

Every capture was fresh and had a session ID, socket and token. The socket was a Unix
socket; the observed path pattern was `/tmp/cc-socks/<Claude PID>.sock`, also shown with
the `uds:` prefix in `/status`. `CLAUDE_SESSION_ID` was absent from the capture hook
environment. `permission_mode` was absent from SessionStart captures; Stop payloads
reported `default` for manual sessions and `bypassPermissions` for the bypass session.

`discover-format.sh` exited **2** on both the preliminary 2.1.280 check and the 2.1.310
check: macOS `grep` rejected `.{0,400}` with `maximum repetition exceeds 255`. This was
not evidence of an absent protocol. Bounded read-only inspection of the installed 2.1.310
binary found the `type: "user"` parser and its own injection example. Live A/B posts
then confirmed this exact envelope (only the marker changed between cases):

```json
{"type":"user","message":{"role":"user","content":"spike01-A: reply here with pong-A; do not use tools"}}
```

Authenticated cases sent this line first, with the freshly captured target token:

```json
{"type":"auth","token":"<REDACTED>"}
```

The working minimal envelope has no `from` or sender-permission attestation. The provisional
`type: "message"` shape in the production adapter was not used or modified in this run.

### Permission/auth matrix

`/config` showed **Messages from your other sessions: default** in both messaging targets.
It was left unchanged. Each target first answered `ready` and became idle. No prompt was
typed between a socket post and the observed automatic response or Held dialog.

| Case | Target / auth | Send UTC (second precision) | Observed outcome |
| --- | --- | --- | --- |
| A | manual / no token | 16:44:58 | Delivered; new idle-session turn; `pong-A` |
| B | manual / token | 16:45:24 | Delivered; new idle-session turn; `pong-B` |
| C | bypassPermissions / token | 16:47:00 | **Held**, no new turn or `pong-C`; still held after 30 s |
| D, optional | bypassPermissions / no token | 16:47:50 | **Held**, no new turn or `pong-D` during observation |

Target transcript timestamps give A's incoming message at **16:44:58.581Z** and `pong-A`
at **16:45:01.128Z** (2.547 s); B's incoming message at **16:45:24.687Z** and `pong-B`
at **16:45:26.496Z** (1.809 s). These are transcript times, not separately instrumented
UI/turn-start times. Buffered terminal polls showed message, active turn and pong by
16:45:13.065Z / 16:45:38.314Z respectively. C's Held dialog was observed by
16:47:12.617Z and D's by 16:48:00.169Z. Exact first-paint/turn-start times were not measured.

Both Held dialogs said the sender did not attest its permission mode while the recipient
bypassed prompts. They displayed an unidentified sender with a verified PID (C: 83479;
D: 83582). Both were explicitly **denied**, never delivered through approval. No inbound
policy or sender attestation was changed to obtain a pass.

**Socket reply: zero bytes in all four cases.** The client half-closed after its eight-second
timeout; the peer then closed after A 8004 ms, B 8003 ms, C 8004 ms, D 8003 ms. All post
processes exited 0. Thus identical transport completion occurred for Delivered and Held;
it cannot be mapped to `accepted` or advance a read receipt.

Read-only source inspection provides an explanation, separate from the live observations:
2.1.310 treats the token as fallback own-child evidence when process evidence is unavailable;
it does not override known non-descendant ancestry. An external poster with no sender-mode
attestation can therefore be Held in a bypass target despite a valid token. This agrees
with the [official inbox documentation](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).
The exact runtime branch was not traced. DESIGN §9's unconditional token-delivery assumption
is not supported for an external daemon by this run.

### Actual stdio MCP binding: two simultaneous sessions, one cwd

Both targets showed `spike01-env` connected in `/mcp` (no tools, as intended), and the
probe logged `initialize` for each process. At **16:54:52Z**, `ps` showed both Claude
parents and both MCP processes alive simultaneously in the same scratch project.

| Target | Hook payload `session_id` | MCP PID / PPID | Matching MCP variable | Initialized |
| --- | --- | --- | --- | --- |
| A | `76d7fa8b-2502-4ffd-a5fc-7165514869c4` | 84491 / 84457 | `CLAUDE_CODE_SESSION_ID` | yes |
| B | `409ac8db-3f61-41d6-957f-9b8a186f5368` | 84545 / 84512 | `CLAUDE_CODE_SESSION_ID` | yes |

**Both IDs matched their own hook payload exactly and differed from each other.** There
was one observed MCP process per session, and each MCP PPID equalled its capture hook's
PPID and the shell probe's Claude parent. The capture hook PIDs were A 84468 and B 84521.
No shared process or extra start was observed in this run's log window.

The observed variable is **`CLAUDE_CODE_SESSION_ID`**, replacing the earlier
`CLAUDE_SESSION_ID` hypothesis. This is real MCP-process evidence,
not a Bash environment inference. This experiment did not exercise production shim binding
or `whoami`; the probe exposed no tools.

### Follow-up — explicit bypass opt-in, 20:03–20:11 UTC

The user authorized **testing** `crossSessionInbound: accept` for one disposable session.
This changes the experiment's launch policy, not global settings or M1's product support
contract. The policy accepts peer messages generally for that session, not only kommutator.
Procedure: [BYPASS_FOLLOWUP.md](01-claude-inbox-socket/BYPASS_FOLLOWUP.md).

Two fresh bypass sessions ran in `/private/tmp/kommutator-bypass-optin.jftt00dy`, with
private non-blocking SessionStart/Stop capture hooks, no MCP servers and no built-in tools.
Both used `--dangerously-skip-permissions --setting-sources local`; the second additionally
used `--settings '{"crossSessionInbound":"accept"}'`. Each answered its initial ready
prompt and was idle before posting. Stop confirmed `bypassPermissions`; SessionStart
again omitted permission mode. `/config` showed `default` in the control; the CLI override
removed the Messages row in the accept target. No dialog was approved to deliver a message.

Each send used the same observed `user/message.content` envelope and the fresh target
token. The sender ran under Codex, outside the recipient's ancestry, and stayed alive for
45 seconds regardless of socket close. `ps` captured each sender alive **after** its socket
closed; the recipient PID was absent from every sender's ancestor chain. The harness did
not supply sender permission attestation or imitate a recipient child.

| Case / policy | Write UTC | Half-close | Outcome | Write → pong |
| --- | --- | --- | --- | --- |
| control / default | 20:05:12.458Z | after 8 s | Held; no new turn/pong | — |
| optin-delayed / accept | 20:09:20.324Z | after 8 s | Native idle turn; `pong-optin-delayed` | 2.712 s |
| optin-immediate / accept | 20:09:45.307Z | immediate `end(frame)` | Native idle turn; `pong-optin-immediate` | 3.130 s |

Control was still Held with no delivered message or pong in the transcript at
**20:06:02.004654Z**, 49.5 seconds after write. The sender had exited normally at 45 seconds;
it remained alive through the required 30-second window. The Held dialog identified verified
PID 86300 and missing sender-mode attestation; it was denied after observation.

The accept transcript records incoming message / pong at **20:09:20.348Z / 20:09:23.036Z**
and **20:09:45.317Z / 20:09:48.437Z**. Incoming-to-pong times were 2.688 s and 3.120 s.
No intervening user prompts or approvals occurred. These are transcript timestamps, not
first-paint or exact turn-start measurements. There was one post per timing in one accept
session; this is compatibility evidence, not a reliability/load test.

**All three socket replies were empty.** They closed after 8003 ms, 8006 ms and 16 ms
respectively, with no transport error. The immediate case used a five-second timeout,
matching the current adapter's write/half-close timing. This verifies that timing with the
observed envelope; the production adapter was **not invoked** and still needs its envelope
replaced. Silence remains `written`, never a receipt or proof of native capability.

The sanitized JSON includes launch arguments, harness source, per-send timings, ancestor
snapshots, hook records and the complete user/assistant text sequence. An independent agent
checked the raw PTY and sender/hook logs before cleanup. Both Claude processes and all three
senders exited; temporary captures, hooks and PTY files were removed. User settings, repository
local settings and scratch hook settings matched their pre-accept hashes before cleanup.
Normal Claude session history was preserved; no global inbound opt-in was installed.

## 02 — ChatGPT desktop app-server

Not run: outside this Mac/Claude runbook.

- App version:
- Socket found at:
- Auth required:
- `thread/list` worked: yes / no
- `turn/start` on an existing thread woke it: yes / no
- `turn/steer` during an active turn: yes / no
- MCP servers spawned per thread or per app (check `ps` while two threads are open):
- Notes:

## 04 — Stop hook blocking

- **Claude Code 2.1.310: passed.** Fresh manual session
  `69a5855f-bb41-478e-9c00-bbb2dd60abed`; built-in tools disabled.
- Baseline unarmed `Reply hi, without tools`: `hi`, then Stop at **16:48:45Z**, active=false.
- Armed only this session's flag at **16:48:56.043Z**. Repeated prompt: `hi`, Stop at
  **16:49:05Z**, active=false; exactly **one** `fired for session ...` log line.
- Exactly **one** extra continuation answered `pong`. Re-entry at **16:49:07Z** had
  `stop_hook_active: true`; it stopped normally. The armed flag had been consumed.
- A further unarmed prompt produced only `hi`, Stop at **16:49:40Z**, active=false;
  no further firing/continuation. Total observed sequence: `hi`, `hi`, `pong`, `hi`.
- The UI labels the blocking reason `Stop hook error`; the observed continuation and
  payload show that the intentional block worked. It did not indicate a script crash.
- Payload field names: `background_tasks`, `cwd`, `effort`, `hook_event_name`,
  `last_assistant_message`, `permission_mode`, `prompt_id`, `scratchpad_dir`,
  `session_crons`, `session_id`, `stop_hook_active`, `transcript_path`.
- Codex CLI and ChatGPT desktop hooks: **not run**. Daemon DND/FYI/hop filtering was not
  exercised by this vendor-semantics probe.

## 06 — Detached spawn

- **macOS Bash-tool descendant survived: passed.** Fresh manual Claude session
  `9be8969f-8831-4e20-a82b-14918a369751`, Bash enabled, no MCP servers. There was no earlier
  spike06 PID file. Approved the single requested command once, without a persistent rule:
  `node /Users/REDACTED/kommutator/spikes/06-detached-spawn/parent.mjs`.
- Exact tool output: `spawned detached child pid=84346; parent pid=84345 exiting now`.
- Claude exited normally via `/exit`, observed at **16:51:12.058Z**. After a further
  12-second wait, `check.sh` ran at **16:51:32Z**, returned **0**, and printed:

```text
PASS: child 84346 is alive and heart-beating (last: 2026-10-25T16:51:32.729Z)
  PID  PPID   SESS COMM
84346     1      0 /Users/REDACTED/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
```

- This heartbeat was from the same child **after Claude exited**. `ps` confirmed the
  expected `child.mjs` command and Node 24 runtime. The verified child was stopped at
  **16:52:08.892766Z**.
- **At the initial run: real MCP survival, two shims attaching to one daemon, and Ubuntu were not tested.**
  The later MCP identity test did not spawn a detached child.

## Initial-run remaining gates and cleanup

The observed matrix is manual/default native, bypass/explicit-accept native, bypass/default
Held. The follow-up establishes a viable opt-in path for an external sender; adopting that
requirement for M1 is a separate product decision. M1 E2E was not run, and no acceptance-scope
change has been applied. Do not promote socket close/exit 0 to acceptance. Steps 3–4 must
integrate the observed `user/message.content` envelope and `CLAUDE_CODE_SESSION_ID`, preserve
unknown permission mode, and keep silence `written`. Real MCP lifecycle and the production
adapter's full delivery path remain due when the shim exists.

Only evidence documentation was changed by this run; no production adapter, protocol,
Git/worktree, or global hook/MCP settings were changed. Build/typecheck/unit tests were
not run because no implementation changed.

Initial-run cleanup completed: all six experimental Claude sessions, both MCP processes and child
84346 were confirmed absent. Removed this run's scratch directory, private captures,
temporary local hooks/MCP config, raw PTY recordings, discovery scratch files, and stale
spike06 PID file. The session-specific Stop flag was already consumed. Existing logs in
`~/.kommutator` and Claude's normal session history were preserved. The saved evidence JSON
parses, report links resolve, and the remaining private capture tokens were checked absent
from both output files before their captures were deleted.

## Production MCP survival and partial M1 run — 20:47 UTC onward

Environment unchanged: Claude Code **2.1.310**, Node **24.19.0**, macOS **27.0.1**.
Steps 1–5 were implemented and reviewed first; all **242** workspace tests and Chromium
dashboard acceptance passed. Evidence:
[production partial run](evidence/2026-10-25-m1-production-partial.json) and
[dashboard checkpoint](../docs/sdlc/m1-dashboard/implementation.md).

- **Real MCP-spawned daemon survival: passed on this Mac.** A fresh private KOM_HOME
  used production `kom init --no-hooks`, `kom hub run` and `kom mcp`. A short Claude
  `--print` session loaded only the explicit production MCP configuration, no plugin/hooks,
  and called `mcp__kommutator__status` exactly once. Its actual tool result reported daemon
  PID **92901**, connected hub and no registered sessions. Claude then exited successfully.
  The same daemon answered a later external `kom status`; it was still alive over two
  minutes after creation. This closes the MCP-parent gap left by the Bash proxy. Ubuntu
  remains untested.
- **One live production session: passed.** Author used the shipped plugin/hooks and
  production MCP in `/Users/REDACTED/kommutator`, with per-session accept and its
  declaration marker. `whoami.vendor_session_id` matched the launched Claude session ID;
  `set_status` changed its handle to `author@m1-mac`. It created and read back `decisions`
  on `project:kommutator`, then became idle with capability native.
- **Two-session native DM/reply/board/handoff: not run.** Automatic approval review
  rejected confirming folder trust for the second Claude session, because that persists
  `hasTrustDialogAccepted` in `~/.claude.json`. At that checkpoint, temporary project trust
  followed by restoration awaited explicit user consent. The user subsequently authorized
  it, enabling the successful M1 run below. This was an execution-authorization blocker,
  not a demonstrated kommutator failure. The first confirmation had completed
  before the second was rejected; its newly added trust field was restored to the original
  absent value after the sessions exited.
- The PTY discarded the beginning of an overly long first prompt. The session reported
  the truncation without taking action; shorter prompts completed the setup. This was a
  test-driver issue, not a vendor transport result. Remote Control login was rejected as
  in the earlier run; local Claude API and MCP calls worked.
- Cleanup: both interactive Claude attempts exited; the test daemon, hub, observer and
  Chromium were stopped and all six recorded process IDs were confirmed absent. Temporary
  credentials/state/PTY captures were removed after sanitized evidence was saved. Normal
  Claude session history was preserved. No global inbound policy or hooks were installed.

The accepted bypass requirement remains explicit per-session `crossSessionInbound: accept`
plus `KOM_CLAUDE_INBOUND_POLICY=accept`; the latter only declares the launch choice. No
native-write/close receipt was promoted to accepted. At this partial checkpoint the full M1
E2E gate remained open; the subsequent run below closes it.

## M1 run — production two-session acceptance

**Passed, 2026-10-25, 22:09–22:13 UTC.** Claude Code **2.1.310**, Node **24.19.0**,
pnpm **10.18.0**, Chromium **151.0.7922.34**, same Mac as the earlier experiments.
Evidence: [curated run JSON, including dashboard observations](evidence/2026-10-25-m1-production.json)
and [independent audit](../docs/sdlc/m1-live/review-implementation-1.md).
The historical dashboard screenshot is withheld from the public tree because its event feed
exposes a personal home path; the original is retained privately. This privacy curation does
not change the recorded browser acceptance result.

Production `kom init --no-hooks`, hub, agentd, MCP shim and shipped Claude plugin/hooks
ran with a private KOM_HOME, random local key and loopback hub. Both Claude sessions used
the real repository cwd, `/Users/REDACTED/kommutator`, explicit MCP configuration,
`--tools ''`, `--dangerously-skip-permissions`, per-session
`--settings '{"crossSessionInbound":"accept"}'` and `KOM_CLAUDE_INBOUND_POLICY=accept`.
The user explicitly authorized temporary folder trust followed by restoration. No global
or repository inbound policy or hooks were changed. Chromium connected before registration.

| Check | Observed result |
| --- | --- |
| Same-cwd identity | `author@m1-mac` and `reviewer@m1-mac` had distinct hub IDs; each `whoami.vendor_session_id` matched its launched Claude UUID. Both reported native capability. |
| Idle boundary | Author returned `ARMED` at 22:10:21.089Z; snapshot showed idle at 22:10:27.907Z. No author input followed until `/exit` after completion. |
| Native request | Reviewer committed request `6e9e84bb-78c8-4e8c-a63c-390870fdceec` at 22:10:41.616Z. Author's transcript recorded the vendor's native peer-message envelope at 22:10:41.640Z and its explicit `read` call at 22:10:47.857Z. |
| Threaded reply | Author committed one pong, `2f2e4e65-867e-4c47-aeb6-51525365f584`, at 22:10:55.998Z: **14.382 s** after the request. `reply_to` and `thread_id` both reference the original request. Reviewer received it natively and read it without replying. |
| Board | Both read the same `project:kommutator / decisions` body at version 1. Author created `handoff/author@m1-mac` version 1 at 22:11:01.256Z and completed at 22:11:06.726Z. |
| Dashboard | Connected throughout; both registrations, two sends, two deliveries and two marked-read events appeared live. Both rows showed idle and both deliveries showed marked read; no page errors. Session-gone events appeared on exit. |
| Parent exit | Author exited normally. Reviewer then successfully called `whoami`, `status` and both board reads. Status at 22:12:17.524Z, **53.198 s** after recorded author exit, showed the same daemon PID **94008**, connected hub, empty outbox and author gone. |

`delivery.read` had cause `ack` and preceded the explicit `read` calls: the new turn's
hook showed the unread header and acknowledged it. These receipts mean marked read.
The native peer-message envelope and autonomous turn establish wake; neither a receipt
alone nor a silent socket close is a positive vendor ACK. Exactly two messages persisted,
with no acknowledgement loop. The UI's Remote Control login still failed, while local
Claude API, MCP and native inter-session messaging worked; login settings were untouched.

After both sessions exited, project trust changed back from `hasTrustDialogAccepted: true`
to its original absent field, preserving other current Claude config fields. All eight
recorded test/launcher/observer/daemon/hub process IDs were confirmed absent. Temporary
credentials, state, scripts and PTY captures were removed after the export was checked
against the actual hub key and vendor tokens. Normal Claude history was preserved; exported
records contain only timestamped user/assistant text and tool calls/results, without hidden
reasoning. The independent auditor matched both transcript exports and hashes to their
designated originals and verified process absence and restored trust.

No production code change was needed. Build → typecheck → all **242 tests** passed again
(protocol 30, hub 136, agentd 47, CLI 29). This closes MVP_PLAN step 6 for the supported
single-Mac, Claude 2.1.310, explicit-accept setup. Step 7's day-long operability check,
cross-vendor/second-host support and Ubuntu remain untested. Git was not initialized;
step 8 still needs a license choice before publishing.


## WSL Docker run — three real agents under concurrent load (2026-10-27)

**Passed for local WSL loopback**, using the running production Docker hub and three real
Claude Code 2.1.310 stream-json sessions with the shipped MCP/hooks/plugin, isolated daemon
state, no built-in tools, and explicit per-session inbound accept. The default model
claude-fable-5-1 rejected initial turns because usage credits were exhausted. After that
attempt was stopped, claude-sonnet-5-5 completed the run. No global policy/settings changed.

- Distinct same-cwd identities matched all three launched vendor UUIDs.
- Idle boreas woke and replied to atlas without operator input; first round trip 9.661 s.
- Three concurrent ring senders each sent three requests; all received one reply each.
- Including the native probe and post-exit exchange: 22 messages, 11 requests + 11 replies,
  no missing/duplicate replies, correct threads/recipients and gap-free delivery sequences.
- All 22 marked read; 19 full bodies explicitly read. Three burst PONGs to cirrus were
  header-marked only. All request bodies were explicitly read; exact reply bodies verified.
- Shared board roundtrip v1 matched across all three; after atlas exited, the same daemon
  served the remaining agents, with connected hub and outbox=0. A further native exchange passed.
- Request-to-reply min/median/max: 6.588 / 9.261 / 11.321 seconds (includes model latency).
- A simultaneous 200-request authenticated snapshot burst, concurrency 8, had zero failures,
  p95 21.66 ms. Periodic Docker samples: 34.62–48.71 MiB RAM, CPU sampled maximum 30.78%.
- Final container healthy, restart count 0, no OOM. Test clients/daemon stopped; test history
  retained under project load-20261027-pxexzxtq. No production code change was needed.

See [run details and limits](../docs/sdlc/wsl-live-load/implementation.md) and
[sanitized evidence](evidence/2026-10-27-wsl-docker-live.json). Remote LAN, interactive browser
rendering, actual reboot, saturation and full-day real-use acceptance remain unverified.

## M2 Codex root identity and hook acceptance — 2026-10-27

Installed CLI: `codex-cli 0.164.0` in WSL2 Ubuntu. Existing shared daemon reported 0.165.0;
it was inspected but not modified or used for these disposable tests. Windows process
inspection found ChatGPT Classic 1.2026.190.0; that is installation evidence, not Work UI
integration acceptance. The standalone app-server used by the tests was 0.164.0.

Two concurrent same-cwd `codex exec` roots, repeated with and without `--no-daemon`,
confirmed separate MCP calls with matching `_meta.sessionId` / `_meta.threadId` and
hook payload `session_id`. MCP child environment IDs were absent. Hook environment IDs
could refer to the launching ancestor and must not be used. SessionStart, prompt,
PostToolUse, Stop and SessionEnd were observed. Context injection was acknowledged;
a Stop block caused a continuation with `stop_hook_active: true` on re-entry.
[Identity evidence](evidence/2026-10-27-codex-identity.json).

Two roots on an owned stdio app-server spawned distinct MCP children with a shared parent
PID. Both calls carried the correct root identity. Parent PID cannot disambiguate them.
[App-server evidence](evidence/2026-10-27-codex-appserver.json).

The production M2 run used the built `kom mcp`, daemon and hooks against an isolated hub
with temporary data/key and private KOM_HOME. Both roots registered distinct identities;
writer sent M2_PING, reader received its header through UserPromptSubmit, read the body
and sent M2_PONG in the original thread (hops 1). Both read the project board; writer's
CAS update advanced it from version 1 to 2. An owned test wrapper queued one test message
immediately before invoking the production Stop hook: `kom hook Stop --vendor codex`
returned `decision: block`, the model continued, and the next Stop had `stop_hook_active`
true and empty output. This wrapper's enqueue time is not product hook latency evidence.
Archiving writer produced SessionEnd/gone; reader retained its identity and successfully
read board version 2. Both eventually ended. Three test messages had read receipts.
[Production evidence](evidence/2026-10-27-codex-m2.json).

The first production attempt completed MCP messaging/board/survival but did not load hooks.
The accepted second run used an isolated, explicitly reviewed hook configuration and
per-thread `bypass_hook_trust: true` solely in the disposable test. No global trust,
permissions, hooks or MCP configuration changed. The consolidated reproduction harness is
[production-m2.py](02-chatgpt-app-server/production-m2.py); it requires a built workspace,
installed authenticated Codex and an unused private scratch directory. It creates its own
hub and agents; it does not use the production Docker database.

Scope: independent root sessions and the local engine hook interface. Hooks identify a
root session tree, not separate subagents. Fork MCP identity is rejected by the product.
No actual Work desktop UI thread, cloud Work command hooks, native idle wake or cross-host
LAN acceptance was verified. Hook delivery and a controlled new turn do not pass spike 02's
native desktop-wake criterion. Official references: [hooks](https://learn.chatgpt.com/docs/hooks)
and [app-server](https://learn.chatgpt.com/docs/app-server).

QA subsequently ran the final consolidated harness successfully; see
[repeat acceptance evidence](evidence/2026-10-27-codex-m2-qa.json). Six turns completed,
35 hooks were recorded, all assertions passed, and owned runtime/auth symlinks were cleaned.

## Installed M2, mixed vendor and Docker recovery — 2026-10-27

The installed Codex configuration was exercised against the real Docker hub after normal
trust of exactly five reviewed hook hashes (no hook bypass). Two owned roots completed
messaging, board CAS and survivor checks; 32 installed-hook invocations completed and
runtime.codex passed during the run. Unrelated configuration/trust entries were preserved.
[Installed evidence](evidence/2026-10-27-m2-installed.json).

A separate owned Codex root sent a request to an idle Claude Code / Sonnet 5.5 session with
explicit per-session inbound accept. Claude woke through its native transport, read and
replied in the same thread; Codex received/read the reply on its next prompted turn.
Both delivery receipts were read. The first attempt's strict MCP launch omitted an explicit
MCP config and failed to expose Claude's tools; the corrected launch passed without product
changes. [Mixed-vendor evidence](evidence/2026-10-27-m2-mixed-vendor.json).

An owned Codex root retained exactly the same identity and board record after an actual
Docker hub restart and daemon reconnect. [Recovery evidence](evidence/2026-10-27-m2-hub-restart.json).
All owned test roots/processes ended. One blocked message from the failed harness attempt
was removed only after exact fixture verification and a private state backup; daemon health
then returned healthy with zero outbox entries. Full details and remaining LAN/desktop gates:
[installed validation](../docs/sdlc/m2-lan/installed-validation.md).


The actual Windows LAN Apply initially failed on hidden non-IPv4 adapter aliases and
rolled back completely. A reviewed/QA-tested fix (80 PowerShell checks) inventories actual
IPv4 interfaces and validates the firewall provider before writes. Corrected Apply succeeded;
repeated Plan validated the installed effective rules. Local Windows HTTP/WS through
192.0.2.10:8787 passed authentication checks. WSL-to-LAN was source-translated to that
Windows address, so it was not a valid outside-subnet test. The user confirmed no separate
machine is available; external subnet acceptance is still open.
[LAN installed evidence](evidence/2026-10-27-lan-installed.json).

## Bundled plugin installation — 2026-10-28

Linux x64 local marketplace artifacts include Node 24 and a standalone client; no global
Node/kom was required in exported-process checks. Real Codex CLI 0.164.0 installed the
artifact, connected MCP with 16 tools, trusted five hooks using exact command/content
hashes in isolated configuration, and recorded two independent same-cwd root contexts.
SessionStart required turn/start; subsequent unauthenticated API requests failed, so no
model completion is claimed. Claude Code 2.1.310 loaded the exported plugin/MCP and
recorded the correct project context. Global client settings were not changed.

Codex legacy MCP on this version requires plugin-relative command + cwd; plugin-root
variables in MCP arguments did not expand. Hook variables did expand. Codex's child
environment filtered custom KOM_HOME, so tests used isolated HOME and explicitly matched
any hook/MCP overrides. Final Codex vendor hook timings were 749/751 ms (SessionStart)
and 722/730 ms (UserPromptSubmit), while Claude SessionStart was 126 ms. Do not claim
200 ms end-to-end Codex delivery from the internal hook deadline.

Real Chromium passed private browser onboarding, wrong-key rejection, 0600 config and
reuse. Exported synthetic messaging/restart/outage tests passed; they are separate from
live vendor conversations and native wake. See [implementation and evidence](../docs/sdlc/plugin-distribution/implementation.md)
and [build/install](../docs/sdlc/plugin-distribution/BUILD.md). Public release, macOS,
Copilot, native Windows and actual Work desktop acceptance remain separate.

Historical licensing note: earlier statements about an unchosen license describe their
dated checkpoint. MIT was selected for public preparation on 2026-10-29; see the root LICENSE.

## Published 0.4.0 plugin diagnostics verification — 2026-11-01

Release [v0.4.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.4.0)
points to `9d2a9a5895256b40b3b35f341ce1d7130ea08244`. Linux x64, Node 24.22.1,
pnpm 10.18.0: 393 workspace tests and all 60 release script tests passed, followed by
export integrity/licenses, clean-PATH smoke and synthetic messaging/recovery E2E.
The exact exported `bin/manage` passed daemon help and plugin-aware doctor checks for
both profiles in temporary homes without starting a daemon.

Both public archives and checksum files were downloaded anonymously; SHA-256 matched the
qualified local bytes and generated catalog pins. Real Claude Code 2.1.310 and Codex CLI
0.164.0 installed 0.4.0 from the public marketplace into separate empty temporary profiles.
Both installed MCP servers initialized as 0.4.0, listed setup tools, returned unconfigured
setup status and served private loopback setup pages. Codex's installed launcher downloaded
and verified its pinned runtime. No live user profile, hub, daemon or credentials changed.

Two verification-harness assumptions were corrected: Codex requires an existing CODEX_HOME,
and its hosted manifest launches `bin/launch mcp`, not the standalone bundle's `bin/mcp`.
The initial corresponding checks failed before MCP startup; the corrected checks passed.
Earlier test failures and independent review are recorded in
[the review artifact](../docs/sdlc/plugin-doctor/review-code-3.md).

Tag [release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41345348907)
and [secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41345348884)
passed. Main [release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41345397372)
and [secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41345397480) also
passed. The source and complete candidate history passed local Gitleaks; two artifact
findings were public dependency license checksum values, independently verified.

This does not establish interactive hook activation/trust on the reporting host, native wake,
actual Work UI, macOS/ARM execution, reboot/logon, physical subnet filtering or day-long use.
The hyphenated feedback topic was not inspected or aliased. Canonical maintenance remains
`kommutator feedback` (space); no live topic operations were performed.

## Published 0.9.0 feedback noise verification — 2026-11-03

Release [v0.9.0](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.9.0)
points to `f622e5976710d952857683643361c4044748c2e7`. On Linux x64, Node 24.22.1 and
pnpm 10.18.0, the final full release gate passed build, typecheck, 454 workspace tests,
114 release-script tests, dependency audit, export integrity/licenses, clean-PATH MCP smoke
and synthetic messaging/recovery E2E. Independent code/security review and QA approved.

The first full gate exposed a stale migration-test expectation, corrected while retaining
legacy topic reply replay. The second passed every preceding gate but failed initial E2E
daemon startup. The same export passed E2E alone and the third full gate passed without
production changes or relaxed assertions. That startup failure has no established root
cause; synthetic success does not prove day-long startup reliability.

Both public archives and checksum files downloaded anonymously and matched the qualified
local bytes and catalog pins. Real Claude Code 2.1.318 and Codex CLI 0.166.0 installed 0.9.0
from the public marketplace into separate empty temporary profiles. Both installed MCP
servers initialized as 0.9.0, listed tools, returned unconfigured setup status and served
private loopback setup pages. Codex's installed launcher downloaded its checksum-pinned
runtime. No live hub, daemon, credentials or existing client profile was changed.

The exact staged source and all 36 commits through the release passed Gitleaks. Two export
findings were public path-key license inventory hashes, verified by recomputing the file
SHA-256 values. Hosted [release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41750679976)
and [secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41750679973)
completed successfully for the release commit; both tag-triggered runs also succeeded.

Live model triage quality, interactive vendor conversations, actual Work UI/native wake,
macOS/ARM execution, reboot/logon, physical subnet filtering and day-long use remain open.
New sender topic copies are absent from inbox history but readable by ID; historical unread
copies remain unchanged. No live hub messages were sent by this maintenance worker.

## 2026-11-04: topic absence recovery, deployed 0.9.1

Release commit eabd81e0f2f6528031688a1673d6c1c3eac1ea45 preserves 0.9.0 sender exclusion
and adds send-time deliveries for gone topic subscribers. Synthetic hub/daemon tests cover
membership boundaries, no immediate absent-session push, same-connection reincarnation,
queued DND ordering, unread receipts, replay and SQLite snapshot/reopen persistence.
The combined workspace passed 462 tests; full release CI and anonymous asset verification
passed. One local exported-client restart check failed transiently, then passed unchanged
in isolation and CI; this does not establish its historical cause.

Observed local activation at 2026-11-04T01:16:29Z: hub image release-0.9.1 healthy; agentd
0.9.1 contract 3 connected/healthy with empty outbox; developer session retained identity
and kommutator-feedback/agentic-forge-feedback membership. Feedback services active.
No production test records were created. Historical missing deliveries were not backfilled.
See docs/sdlc/topic-offline-delivery/deployment.md. Vendor resume, day-long, Windows reboot
and physical allowed/denied-subnet gates remain open.

## 2026-11-04: remaining reliability investigation (baseline db2493f / 0.9.1)

Read-only inspection of private daemon log records, independently re-read by the parent
agent, yielded the following sanitized fields. The historical daemon version was 0.8.1.

| UTC | Event | Session | Vendor | PID | Reason | Cause |
| --- | --- | --- | --- | --- | --- | --- |
| 00:43:15.968 | session.gone | dd56f08c-e1fa-47c4-a8dd-d26353206538 | codex | 589518 | liveness | process-exited |
| 00:44:14.319 | session.heartbeat-failed | ac2786f9-9568-4cbf-9c00-10e2e09c6560 | claude-code | 2454907 | hub-unavailable | not recorded |
| 00:47:54.413 | session.heartbeat-failed | ac2786f9-9568-4cbf-9c00-10e2e09c6560 | claude-code | 2454907 | hub-unavailable | not recorded |

Source: ~/.kommutator/agentd.log, exact timestamps above; raw logs remain private.
This proves what the daemon logged, not independent OS liveness or why the shim exited.
The heartbeat events identify a different registration and do not prove false retirement.
The original Claude incident's retirement cause remains unresolved. No exact-root vendor
shutdown correlation was established.

During this investigation `claude --version` returned 2.1.318 (Claude Code). This local
observation does not demonstrate Monitor execution; official documentation supports the
interface, while an actual vendor Monitor trial remains open.

An isolated in-memory probe loaded the retained deployed 0.9.1 agentd bundle with synthetic
config, disconnected fake transport, processStart returning undefined and processExists
returning true. A Codex shim hello created an active record with no birth; sweep changed
it to gone/liveness and logged cause missing-process-owner. No production state was used
or mutated. This reproduces a separate uncertainty-handling defect; it does not explain
the historical process-exited event above.

## Session delivery reliability: diagnostic storage stall (2026-11-04)

A 0.10.0 candidate based on 633e85b failed one GitHub Claude B→A→B process case: the final
whoami returned A. A separate CI run passed; the exact cause of that event is unproven.
A controlled Node 24 subprocess preload then stalled only mkdir calls for the private
hook-observations directory. Before the fix, a control SessionStart created its authority
journal (one record, 145.5 ms); the diagnostic-stall case exited zero in 176.7 ms with no
journal. The permanent resume regression independently retained launch-a instead of
resumed-b under the same diagnostic-only stall. No user runtime state was used.

The final 0.10.0 implementation serializes observation writes in the background and never
awaits them before authority/delivery. The unchanged entrypoint timer bounds final flushing.
The three-case resume process file then passed, including stalled-diagnostic SessionStart
and SessionEnd. This proves the isolated optional-I/O defect and its regression fix, not
the exact cause of the historical shim exit or the intermittent CI event.

## 0.10.0 local activation and live topic watch (2026-11-04)

Tagged 9700b2796e77becd1f5aef3147c5411c6cfd1184 passed full release qualification and
GitHub checks. The authorized updater activated hub and daemon 0.10.0 with SQLite backups;
Docker was healthy, transport connected and outbox empty. The developer's existing session
ID and subscriptions survived. An installed Codex 0.10.0 CLI watch tailed feedback silently
for 12 seconds, then a separate explicit replay returned 12 ordered already-read headers
without changing the recipient's delivery rows. No test messages/registrations were added.
This verifies CLI observation, not native vendor Monitor. Existing live MCP client code
remained 0.9.1 until vendor reconnect; installed Claude/Codex plugins are 0.10.0. See
`docs/sdlc/session-delivery-reliability/deployment.md` for evidence limits and remaining gates.


## 2026-11-11 — Node26 frozen candidate qualification

Candidate `f948359aa48281b1994cccbe8556b1169fe82404` (0.12.0), Linux x64 WSL,
Node26.13.0 / pnpm12.18.0. This evidence-only commit does not move the candidate or rebuild
its archives. Fresh detached checkout/private HOME passed frozen install, ordered build,
typecheck and 520 tests, then full release:check (520 tests, 134 script tests, audit, export
smoke and synthetic cross-vendor E2E). Lockfile remained unchanged.

Retained tar SHA256: `a188b13426cdd89cbc773f798555780c059c178f039e48f806f3a69705ef71bf`.
Claude ZIP SHA256: `4b0c3aefe3e01b3d0d620273ba4b9a51ec330f3bb671e66fc187e5d8b3e0914e`.
Both archives passed source-catalog/internal-payload verification, actual retained export
smoke and E2E. Bundled Node bytes match the separately signature-verified Node distribution.
Source secret scan was clean; two artifact matches were verified runtime checksum manifests.

Docker candidate manifest-list digest:
`sha256:00ea3634985fce27566da6f5f58b202c9f0c52c7e7d2895877e29c9901581f10`.
Observed image Node26.13.0, application0.12.0 and project LICENSE. The existing disposable
Docker smoke passed 18 checks: non-root/read-only/secret isolation, authenticated HTTP,
two-host messaging/read receipt, online backup/no overwrite, recreation persistence,
graceful exit, backup restore, crash restart and malformed/missing key rejection.
No production container, key, database or LAN settings were changed for these checks.

Actual retained-export fail-open hook timings (milliseconds, Claude/Codex): cold absent
daemon138.76/122.56; malformed112.90/111.96; verified warm cache without daemon131.52/135.55;
stalled stdin174.60/180.37. All eight exited0 with empty stdout/stderr under200ms.
An initial Python polling-wait harness inflated one measurement; blocking EOF/wait with a
separate watchdog corrected the harness. No runtime deadline/assertion was relaxed.

A disposable systemd timer/worker demonstrated that timer stop leaves an active process
holding flock, a competing invocation fails75, and Node26 can take the lock only after the
Node24 worker drains. Initial fixture scheduling exceeded its deadline under systemd's
normal timer accuracy; explicit100ms fixture accuracy made the intended race deterministic.
This is generic cutover orchestration evidence, not an actual production update.

An initial local hook-observation test failure passed isolated/full repeats. One GitHub
cold-hook timing check measured226.86ms; the parallel exact-commit run and a single failed-job
rerun passed. All latest exact-candidate Release checks and Secret scan runs are green.
These observations do not establish arbitrary-load latency, real-vendor wake, physical
subnet access, reboot/logon or day-long reliability. Publication/deployment are separate.


## 2026-11-11 — Published 0.12.0 and local Node26 cutover

Release v0.12.0 points to frozen source `f948359aa48281b1994cccbe8556b1169fe82404`.
The release assets were uploaded unchanged, then anonymously downloaded and matched the
previously recorded tar/ZIP SHA256 values. Catalogs reached main only after publication.

Native clean-profile installers succeeded with Claude Code2.1.322 and Codex CLI0.167.0.
The installed launcher MCP probes reported0.12.0 and bundled Node26.13.0; tools/list,
unconfigured setup_status, private loopback setup form and cross-origin rejection passed.
These were direct protocol probes of native-installed plugins, not model conversations or
live wake qualification. Codex warned that helper PATH aliases are unavailable under a
/tmp CODEX_HOME; plugin installation and its launcher checks still succeeded.

The production updater timer was stopped; the service drained/inactive, kernel lock free,
and checkpoint idle0.11.0 before publication. A private retained Node26.13.0/pnpm12.18.0
prefix passed an actual systemd environment check. The old service unit was backed up;
only its working directory, executable and PATH changed. Explicit cutover selected the
qualified version and source commit, verified downloaded assets, took both SQLite backups,
activated the hub and restarted agentd. Both pre-upgrade backups passed PRAGMA quick_check.

Observed after cutover: hub0.12.0 and daemon0.12.0 both run Node26.13.0; runtime contract3;
hub connection true, health healthy, no reported issues. Production image
`kommutator-hub:release-0.12.0` has image ID
`sha256:22931a75502094fc1a7cccb05e1d779ee0e56615de346b9f2fa834581df23510`.
It was rebuilt from the frozen source and independently smoke-tested before activation.
The maintainer's existing Codex MCP0.11.0 reconnected with the same hub session ID and a new
incarnation; this does not claim an in-place client plugin update. The normal updater
oneshot completed successfully and the timer returned to active/waiting with checkpoint
idle/applied0.12.0. Existing key, data and single-subnet ingress configuration were preserved.

A real release announcement was persisted to kommutator-feedback as message
`18026824-705f-4986-89a8-5116632732fc`, status sent, five recipient deliveries initially
unread. This is live client-to-hub publication evidence, not recipient-read proof.
No synthetic production messages or sessions were created. The previously listed
physical-subnet, reboot/logon, endurance, other-platform and native-wake gates remain open.

## 2026-11-11 — 0.12.1 acknowledgement diagnostics publication and local rollout

Frozen source/tag: `c1f63b700249884ac9e22fc604a9bf94500aad5b` / `v0.12.1`.
Published development preview: https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.12.1 .

- Ordered build/typecheck and 526 workspace tests passed; full release qualification also
  passed 134 script tests, audit, export integrity, clean-PATH setup/cache smoke and synthetic
  cross-vendor messaging/lifecycle E2E. Independent correctness/security/external review and
  QA approved. Exact-candidate CI runs 43089149796, 43089155152 and 43089172954 passed,
  alongside their Secret scan runs. Source diff scan was clean; two artifact generic-key
  matches were verified payload SHA-256 manifests, not credentials.
- Anonymous public downloads matched Linux tar SHA-256
  `536bfe48bfe6661403c06f4ed9a030d15f5b915b7b10bebfe5bcaac19bf91407`
  and Claude ZIP SHA-256
  `a216760ddbfef47a74aa1444af0addfeac8c9a78400e892f1b603ff2b365c801`.
- Native installation from the public repository passed in separate empty profiles using
  Claude Code 2.1.322 and Codex CLI 0.167.0. Installed MCP reported 0.12.1 on bundled Node
  26.13.0; private setup HTTP/origin checks passed. These were installation/protocol probes,
  not actual vendor model conversations or native-wake acceptance.
- The authorized local updater applied 0.12.1 to the Docker hub and shared daemon. Final
  checkpoint was idle/applied 0.12.1; hub container `kommutator-hub:release-0.12.1` was healthy,
  daemon reported 0.12.1, caller was active, hub connected and outbox empty. Both pre-upgrade
  SQLite backups passed `PRAGMA quick_check`. The updater timer resumed active/waiting.
- A live acknowledgement of an already-read feedback message through the existing compatible
  0.11.0 client returned `requested=1`, `matched=1`, `marked_read=0`, `already_read=1`,
  `unmatched=0`. No synthetic production messages or receipt modifications were needed.
- Release/deployment announcement sent to `kommutator-feedback` as message
  `432fe5e0-95be-400f-8bcd-7adaf9999bad`. Sent is not proof all recipients read it.

The original unread-replay report remains unconfirmed; this release fixes ambiguous ack
reporting. Hook latency issue #9 remains open under the temporary 300 ms observation gate.
Physical subnet clients, Windows reboot, day-long reliability, Work desktop/native idle wake
and other-platform execution remain separate acceptance gates. Runtime backups, toolchains
and deployed clones remain private and were not committed.

Reporter follow-up (message `9ce00c62-44a3-4b9e-8ff5-84c366322b99`, received
2026-11-11): the affected live 0.11.0 client successfully acknowledged one complete message
ID, then the remaining roughly fifty IDs, leaving an empty unread inbox. The earlier failed
call's exact arguments were lost during context compaction, so its cause remains unknown.
This is peer-reported live evidence, not an independently repeated vendor test; it supports
the diagnostic correction without establishing a receipt-persistence defect.

## 2026-11-11 — rejected outbox 354 recovery and resumed client

After the session restart, `setup_status` reported MCP client and daemon 0.12.1, contract 3.
The root caller was active with both feedback subscriptions. Initial hook failures during
restart were followed by successful observations. Health was degraded solely by one blocked
send: a bare `agentic-forge-feedback` address.

Read-only inspection attributed entry 354 to the local Claude Agentic Forge developer.
The same author had already published identical subject/body to the canonical topic in
message `2eca9b49-a986-49e7-9136-e5fef4cba3e8` (13 delivery rows); the rejected operation's
idempotency key was absent from hub messages. The operator preserved the rejected row and a
private `VACUUM INTO` database backup (quick_check: ok), then deleted only the exact unchanged
row using all stored fields as conditions under BEGIN IMMEDIATE. No message was resent and
no hub receipt changed. Final status: active caller, connected hub, healthy, outbox depth 0.
Private backup/state were not added to source. This evidence authorizes no automatic cleanup
of other queues or uncertain deliveries.

### 2026-11-11 — 0.12.2 publication and verified local rollout

Published immutable development-preview tag `v0.12.2` at
`87ad0cd3e05bcfc626a46d2013a688018d3d7f04`; PR #14 merged as `a21b978`.
Final local qualification passed 552 workspace tests, 134 script tests, export verification,
clean-PATH installation/setup smoke and synthetic cross-vendor lifecycle E2E. All 12 local
hook observations were 115.193–182.817 ms. Exact-commit branch, PR and tag Release checks and
Secret scan runs passed. Earlier failed qualification observations and subsequent fixes are
retained in `docs/sdlc/outbox-address-validation/review-change-1.md`; no timeout was relaxed.

Anonymous downloads matched both published sidecars and pinned catalog hashes:
- Linux tar: `a9ace9c5a9c4eebe6add69aa0f41c271a306b1bc8717f2b1f0bc9f9a0e7d202f`.
- Claude ZIP: `56818f84c8c3f9bceff29629034eaf987e25cbd2e1486bf5a6dec1b4bfe7155b`.

Actual Claude 2.1.322 and Codex 0.167.0 CLIs installed the public GitHub marketplace/plugin
into separate clean homes. Both installed MCP servers reported 0.12.2 with bundled Node
26.13.0; private loopback setup returned HTTP 200 and rejected a foreign Origin with 403.
These are installed-process probes, not real model conversations or native idle-wake proof.

The local updater built and smoke-tested the release image, backed up both databases and
activated Docker hub 0.12.2. Its daemon restart then received `ECONNRESET`; the old process
had exited and its socket was absent. The updater correctly blocked without automatic retry.
A manual start from the same verified retained release checkout launched daemon 0.12.2.
Actual executable/command, hub package version and Node 26.13.0 were checked. Current MCP
status then showed an active caller, healthy connected hub and outbox depth 0. Both private
backups had mode 0600 and passed SQLite `quick_check`. Only after those checks was the
attempt reconciled as accepted; checkpoint is idle/appliedVersion 0.12.2 and timer resumed.
The checkpoint's previous automated result remains historical; the acceptance note records
this manual completion. Issue #15 tracks the shutdown-reset restart transition separately.

The current chat MCP process remains compatible 0.12.1 (contract 3); it was not silently
replaced. The `kommutator-developer` role and canonical `kommutator-feedback` and
`agentic-forge-feedback` subscriptions were verified after daemon restart. Announcement
`6690e3d6-99f3-483b-8993-f1f5adf3d9fa` was sent to `kommutator-feedback`; queued recipient
receipts were not claimed as reads. Issue #13 is closed by the qualified retirement recovery;
issue #9 retains the temporary 300 ms process cap and 200 ms target. Original unread replay
causality remains unconfirmed. Physical-subnet, Windows reboot, day-long reliability,
ChatGPT Work/native idle wake and other-platform gates remain open.

### 2026-11-12 — current Codex client after plugin reload

The current session's actual `setup_status` reports client 0.12.2 and daemon 0.12.2,
runtime contract 3 compatible. Fresh `whoami` reports an active Codex root with the
`kommutator-developer` role and membership in `kommutator-feedback` and
`agentic-forge-feedback`. This supersedes the previous rollout's observation that its
long-lived MCP process was still 0.12.1; no identity was inferred from cache paths.
This verifies the connected MCP version and registration, not native idle wake.

### 2026-11-12 — bounded hook phase diagnostic and restart regression

The isolated diagnostic used Node 26.13.0 on Linux x64 and an intermediate 0.12.3
candidate based on 7747c5d. [Sanitized measurements](evidence/2026-11-12-hook-phase-timing.json)
retain the exact built artifact hashes; these are not final release asset measurements.
Three scenarios each ran three untraced controls and three interleaved traced samples.
Untraced min/median/max milliseconds were 143.403/143.971/277.723 for manual
configured-cold SessionStart, 176.846/177.305/187.118 for Claude plugin SessionStart,
and 134.745/136.073/150.973 for responsive Codex Stop with synthetic ACK failure.
All 18 processes exited successfully with their expected stdout behavior.

One untraced sample exceeded the 200 ms target but remained below 300 ms. Its internal
phases were not traced, so its cause remains unknown. A null deadline field means
unobserved in an untraced control. Trace startup includes instrumentation imports;
three samples do not establish calibrated tracing overhead or tail latency. The
configured-cold path has no plugin profile and differs from plugin authority preparation.
Traced Claude runs persisted authority records before the entrypoint deadline; this
is not proof of native Claude registration. Observed parent exit-to-close gaps were
0.006–0.032 ms, not evidence for the original CI outlier's cause. Issue #9 stays open;
300 ms process cap, 200 ms target and internal 140/90 ms timers are unchanged.

A disposable Unix socket fixture reproduced #15 against the built 0.12.2 baseline:
a reset during shutdown caused restart to fail before replacement. The candidate
confirms listener absence with fresh non-starting probes and starts exactly one
replacement. Focused tests also cover persistent listeners, stage-specific failures
and cancellation of stalled hello/shutdown/confirmation requests. No production
daemon was interrupted by this diagnostic. Live rollout qualification is separate.

### 2026-11-12 — 0.12.3 publication and ordinary local rollout

Release tag v0.12.3 is 6d7f76f638a5e0ca0fc6458d9c524096835207f5; PR #17 merged.
One full Linux x64 qualification passed: 571 workspace tests and 134 script tests,
export integrity, clean-PATH smoke and synthetic client E2E. Independent correctness,
security, external review and QA approved. Branch, PR and tag CI passed. Source/history
secret scans passed; export manifest digest matches were independently verified.
Fresh final export manifests matched the staged release payloads.

Anonymous downloads matched SHA-256:
- Linux tar: `5303d767d77b8aca468e6a1dfdfa69e2644ee798fa8672e4fcf7f85dd65d57b4`.
- Claude zip: `bd18d880422d03ec3bd0d70dc3fc90bd591af9af229dd7009b03e178842c3bd4`.

Actual Claude 2.1.322 and Codex 0.167.0 installed through the public marketplace in
clean profiles. Both installed MCP processes reported 0.12.3 and bundled Node 26.13.0;
private setup returned HTTP 200 and rejected a foreign Origin with 403. These are
installed-process probes, not real model conversations.

The authorized local updater completed normally without manual recovery: Docker hub
image kommutator-hub:release-0.12.3 is healthy, actual hub package and daemon are 0.12.3,
and daemon PID 1939141 uses the private Node 26.13.0 executable. Checkpoint is idle with
appliedVersion 0.12.3. Both pre-upgrade backups had mode 0600 and SQLite quick_check ok.
Timer resumed. Fresh MCP status showed healthy connected hub, active caller and empty
outbox. Current chat MCP remains compatible 0.12.2, runtime contract 3; role and canonical
feedback subscriptions persisted. Announcement 89b12e89-68e3-48e4-92a6-d5ce2b91433c was
sent to kommutator-feedback; unread recipient deliveries are not claimed as reads.

Issue #15 is closed. Issue #9 remains open: isolated timing outlier causality is unknown.
Day-long reliability, Windows reboot, physical-subnet, Work/native wake and other-platform
acceptance gates remain open.

### 2026-11-12 — subsequent documentation CI registration failure (#19)

After publication, documentation commit 159847a triggered branch run 43129502651,
which failed the lifecycle fixture's initial paired whoami at line 220: vendor
session not registered yet. It did not reach the first-shim-exit assertions.
Parallel PR run 43129509884 passed. No CI rerun was requested. This does not alter
the earlier successful qualification records or establish a 300 ms timing failure.

A disposable IPC server rejecting ipc.hello deterministically demonstrated that
the actual hook still exits 0 with empty stdout/stderr and records outcome failed.
The fixture's original exit assertion therefore does not prove registration. The
original CI cause and which of the two roots failed remain unknown; issue #19
tracks this separately from latency #9. Follow-up diagnostic coverage retains
single attempts, timing budgets and identity assertions, and reports only bounded
fixture hook outcomes and explicitly selected hub identity fields on failure.

### 2026-11-12 — bounded registration reproduction sample (#19)

At unchanged 98ddb0b, Node 26.13.0/pnpm 12.18.0, ten sequential lifecycle runs
passed all 40 tests; the predeclared stop-on-failure condition was not reached.
[Sanitized provenance](evidence/2026-11-12-registration-reproduction.json) records
each run and log digest. Initial invalid package-filter invocations executed no
tests and are explicitly excluded. Passing console timing output was suppressed,
so this is lifecycle outcome evidence, not a hook-latency distribution. The original
CI failure did not reproduce; #19 stays open without a speculative registration fix.

### 2026-11-12 — hook import isolation A/B (#9)

The IPC client imported pathsFor through the agentd barrel. Its built hook graph
loaded an approximately 85 KB chunk including node:sqlite, ws and daemon schemas.
The existing /paths export exposes the same function without those dependencies.
A controlled resolver-denial test fails on the baseline (SQLite import attempted,
exit 0 but no visible header) and passes after the one-line import change, requiring
visible output and the exact acknowledgement ID. Candidate IPC chunk is about 9.3 KB.

[Paired measurements](evidence/2026-11-12-hook-import-ab.json) retain artifact hashes
and the pre-version-bump candidate diff hash. Ten untraced pairs per scenario were
alternated, plus three traced pairs. Untraced median milliseconds baseline→candidate:
manual configured-cold SessionStart 160.641→138.933; responsive Codex Stop
151.998→124.676; Claude plugin SessionStart 184.489→184.260. Each group contains
ten samples; these are local observations, not CI tail-latency or causal proof for
the historical outlier. Tracing adds overhead. All six traced Claude-plugin runs
reached the unchanged 140 ms entrypoint deadline after publishing authority;
these synthetic owner/probe runs do not prove successful native registration.
The optimization improves two observed medians; no plugin-path improvement is claimed.

The temporary measurement server aborted on an unhandled socket ECONNRESET after
59 complete samples. Its missing error handler was corrected to retain socket codes;
only the remaining 19 planned samples were executed, including the interrupted
sample whose original outcome was unavailable. Earlier results were retained.
The error is a fixture observation, not an established product defect. Runtime source
did not change between measurement segments. All 78 completed samples satisfied
expected output/exit assertions; their timing values are retained without filtering.
#9 remains open, with 300 ms cap, 200 ms target and unchanged 140/90 ms timers.

### 2026-11-12 — exported cold authority diagnostic (qualification blocked)

The first full 0.12.4 qualification passed 573 workspace and 134 script tests,
then failed the first Claude owner's whoami in exported E2E. Five interleaved
baseline/candidate pairs were run with sanitized authority snapshots and no
registration retries. [All samples](evidence/2026-11-12-cold-authority-diagnostic.json)
record baseline 5/5 passing and candidate 4/5 passing. The original first-whoami
failure did not recur. One candidate failed during its second hook before MCP;
both owners were alive and both matching generation-1 journals were committed.
The temporary sanitizer discarded its error message, so its exact cause is
unavailable and must not be classified as a timeout.

Completed exported wrapper-to-close hook durations ranged 159.714–761.972 ms on
baseline and 141.294–731.751 ms on candidate. This metric includes the wrapper and
differs from the earlier direct-Node A/B; no reliable wrapper-latency improvement
is established. Post-run host load is context only, not evidence of the cause.
The release remains blocked pending diagnostic qualification; no service update
or publication occurred during these experiments.


## 2026-11-12 — restarted session and blocked 0.12.5 qualification

Observed MCP 0.12.3, daemon 0.12.3 (contract 3 compatible), active caller, connected
hub and empty outbox. Docker `kommutator-hub:release-0.12.3` is healthy. Canonical
Kommutator and Agentic Forge feedback memberships are retained. Native hook
headers were delivered after restart; individual failed hook observations remain,
so this does not certify every hook invocation or native idle wake.

The staged 0.12.4 branch check 43135901281 failed a rejected-hook observation
assertion (`attempted` instead of final `failed`). Same-commit PR 43135906663 and
tag 43135917242 passed; no rerun was requested. Independent review identified
the test's invalid guarantee of best-effort final persistence. The immutable
0.12.4 tag/assets remain an unpublished draft. Candidate 0.12.5 separates the
real-process rejection/zero-registration contract from deterministic final
observation persistence. Eight focused tests passed, and internal/external
review approved that correction without findings.

One complete 0.12.5 qualification passed build/typecheck and 573 workspace tests
but failed `claude-resume-process.test.ts:203`: after SessionEnd with diagnostic
storage intentionally stalled, `whoami` still succeeded. Initial and resumed
identities passed. SessionEnd took 208.118 ms, below the 300 ms test cap; this
is a semantic failure, not a timing assertion failure. Script/export stages were
not reached. The original cause is unknown; cleanup removed the fixture state
and the assertion did not print its collected authority evidence. Log retained
locally at `/tmp/kommutator-v0125-release-check.log`; no credentials are included
in this report. No production deployment occurred.

Second qualification after reviewed failure-only diagnostics passed 572 workspace
tests and failed two. Original stalled-observation retirement passed (187.984 ms).
B-to-A-to-B instead retained A after a 230.683 ms final B SessionStart; recorded
journals contained only generation 1 B and generation 2 A. Missing next-generation
publication is observed, but its cause is unknown. A separate delayed-delivery
retirement fixture reported an IPC timeout with no definitive operation/cleanup
label. Build/typecheck passed; script/export stages were not reached. Log:
`/tmp/kommutator-v0125-release-check-round2.log`. No release/deployment occurred.

A bounded follow-up phase diagnostic first failed because its execFile wrapper
did not preserve Node's promisify metadata; that run is invalid for product
conclusions. One corrected trace preserved the actual custom-promisify descriptor.
All four SessionStart generations published, with atomic links completing at
106.94, 102.02, 102.42 and 117.40 ms after preload. Hook durations were
172.29–207.35 ms. Three deadline callbacks fired at 143.57, 144.23 and 146.19 ms
after publication. The later IPC timeout's operation/cleanup phase remains
unidentified. The preserved descriptor bypassed the ps timing wrapper, so no ps
duration conclusion is available. Missing publication was not reproduced.
Logs: `/tmp/kom-v0125-phase-diagnostic.log` (invalid instrumentation) and
`/tmp/kom-v0125-phase-corrected.log` (corrected trace). No runtime changes followed.

A separate contemporaneous host sample showed six CPUs and high I/O pressure
(some/full avg10 86.46/81.03 percent). It was not sampled during each failing hook
and does not establish the historical cause. Other workloads were not stopped.
Next: label body versus teardown IPC operations and preserve original body errors
when cleanup fails, then trace publication phases under the failing workload.
Do not relax timers, identity fences or assertions, or repeat qualification merely
to obtain a passing result. Both candidate release and local deployment stay held.


### 2026-11-12 — final 0.12.5 integrated qualification

MCP EOF cleanup was confirmed by a real-process baseline failure with active IPC
and private setup resources. The fix and in-flight handler fence passed controlled
EOF/setup/deferred-resource tests, without stopping the second MCP or shared IPC
fixture. Source and external reviews approved. Fixture cleanup now labels phases,
preserves original errors and verifies process ownership before fallback signals.
The original no-EOF baseline is valid; a later loader negative control failed at
initialization and is excluded from product conclusions.

Canonical hello extraction retains schema identity and all process/generation
fences. A bundled-import regression failed on the old build and passed with the
narrow export. Intermediate six-sample import data is retained in
[evidence](evidence/2026-11-12-authority-import.json); it is not end-to-end evidence.

One final full release:check passed: 584 workspace tests (39 protocol, 176 hub,
118 agentd, 251 CLI), 140 script tests, ordered build/typecheck, export verification,
both clean-PATH smokes and all synthetic exported E2E scenarios. Earlier failed
qualifications remain above; their original trigger is not established. No live
model/native wake, day-long, physical subnet, reboot or other-platform acceptance
is implied. Log: /tmp/kommutator-v0125-final-release-check.log.


## 2026-11-12 — 0.12.5 publication and observed local deployment

- Release commit `4bfc4984dc770ff5e704ff8e4dc3216d6c68fcf2`; PR #20 merged as
  `080831217e02e7a97f4592fa2e553b7f30caf3fb`. Branch/PR/tag Release checks
  43274533262, 43274543969 and 43274559170 passed, as did all three Secret scans.
  Source and 65-commit history scans found no leaks. The immutable unpublished
  0.12.4 draft remains superseded.
- Stopped the updater timer, confirmed the service inactive and lock free, then
  published 0.12.5 assets before merging the hosted catalogs. Anonymous downloads
  matched tar SHA256 `93b564874adf1b8bb2d3621214da1cb9c62eda3fc399c44a0f3d7a874dc8fe63`
  and Claude zip `2845472a39cee6034f59ec63e41c9ce3ffc5b29238aeccf71231713b6efc3876`.
- Actual Claude 2.1.322 and Codex 0.167.2 CLIs added the public marketplace and
  installed 0.12.5 into separate clean profiles. Installed MCP initialize reported
  0.12.5 and bundled Node 26.13.0; private setup returned HTTP 200 and rejected a
  foreign Origin with 403. These are installer/MCP probes, not model conversations.
- The ordinary systemd updater completed without manual recovery: checkpoint idle,
  applied/target 0.12.5, exact release commit, Docker image release-0.12.5 healthy,
  container package 0.12.5 and daemon PID 3768959 from the retained release clone
  using Node 26.13.0. Both pre-update SQLite snapshots were mode 0600 and returned
  quick_check=ok. The timer was restored active.
- Fresh live tools reported daemon 0.12.5 compatible with this chat's MCP 0.12.3,
  active caller, connected hub, healthy with no issues and empty outbox. Current
  role and both canonical feedback subscriptions survived. No claim that an
  existing MCP process was upgraded in place. Main checkout fast-forwarded with
  all three user-owned local documents preserved byte-for-byte and backed up.
- #9 and #19 retain their original unresolved causes and were updated with evidence.
  A same-day peer availability report coincided with local hub-unavailable errors;
  Docker had not restarted. Cause is unproven; EOF cleanup is not claimed to fix it.
  Day-long, physical subnet, unattended reboot, native Work/wake and other-platform
  acceptance gates remain open.


## 2026-11-12 — #9 scheduler contribution and #19 registration race

Bounded investigation on 0.12.5 collected 80 interleaved hook samples. One untraced
manual cold start took 310.501 ms (cause unknown). A natural traced 207.380 ms
outlier entered JavaScript at 90.204 ms; Linux schedstat measured 54.349 ms total
main-thread runnable wait, 38.327 ms already before preload. The hook finished
without firing its deadline. Scheduling delay is an observed contributor to this
sample, not proof of all historical CI causes or a calibrated tracing correction.

For original manual lifecycle #19, a baseline passed; injecting 200 ms before local
registration reproduced the exact missing-registration error with hooks below
200 ms. Delaying only hub upsert did not. A post-failure-only snapshot showed the
missing record appear without another hook/identity-call retry. This proves that
fail-open hook exit can race an accepted but unfinished daemon registration. The
injected delay does not identify the original slow prerequisite. No production fix,
timer increase or assertion relaxation was made; both issues remain open.

See [investigation](../docs/sdlc/hook-registration-investigation/investigation.md)
and evidence `2026-11-12-hook-scheduler-investigation.json` /
`2026-11-12-registration-race-investigation.json`. Next instrument accepted hello,
registration queue/process-birth/local-save/flush boundaries in the CI fixture.


## 2026-11-12 — 0.12.6 accepted-registration recovery qualification

Candidate 0.12.6 adds a 250 ms bounded wait only for an already accepted matching
manual Claude hook registration, then verifies process birth and fresh identity.
Shutdown/disconnect fence all new asynchronous boundaries; hook timers, schemas,
receipts and replay remain unchanged. Nineteen new core behavior cases cover
success, failure, timeout, late tickets, owner/generation changes and cancellation.

Unchanged 0.12.5 failed the new regression in an independently installed baseline;
candidate passed the original real-process 200 ms delayed-registration control with
both hooks hitting their unchanged deadline and no new hook or whoami retry. The
first baseline setup shared dependency links and is invalid; links were restored,
verified and qualification repeated. Initial assets are quarantined; fresh qualified
assets were regenerated after restoration.

One intermediate full workspace gate failed 2/603: rejected hook sent no hello;
cold SessionStart took 375.141 ms, above the unchanged 300 ms cap. Causes remain
unproven. Follow-up instrumented cold, bounded 16-case and full 251-test CLI runs
passed; these do not erase the failures. Phase diagnostics and limits are recorded
in `evidence/2026-11-12-pending-registration-diagnostics.json`.

Final single release:check on the completed reviewed changes passed 603 workspace
and 140 script tests, build/typecheck, export integrity, both clean-PATH smokes and
synthetic E2E. Independent correctness/security, external review and QA approved.
See [review](../docs/sdlc/pending-registration/review-change-2.md). Publication and
local rollout still require observed evidence. #9 and unproven historical #19 causes,
missing plugin generation publication and environment-dependent acceptance remain open.


## 2026-11-12 — 0.12.6 published, CI traced and locally deployed

- Release commit `3f08b5a9cb73db943c02ac9f9a57d13625a65c6d`, PR #21 merged as
  `1aeee8273789b71341a1707b74098d2984708e27`. Exact-commit branch/PR/tag Release
  checks 43285349145, 43285360054 and 43285360373 passed, including the new phase
  sample; all three Secret scans passed. Changed-source/history scans were clean.
  Export scanner matches were two release-manifest hash metadata entries; all 191
  payload hashes per vendor were verified.
- Branch CI emitted four traced parent durations: 100.447, 114.770, 94.785 and
  89.364 ms; entry at 21–24 ms, main-thread scheduler wait 0.006–0.113 ms. No
  above-target timing was printed in that run. Raw fixed-field phase evidence is
  `evidence/2026-11-12-registration-ci-phases.json`. This is not an explanation for
  earlier untraced failures or proof of a permanent latency guarantee.
- Timer stopped, updater inactive and lock free before assets were published and
  catalogs merged. Anonymous downloads matched tar SHA256
  `5eb6d8e1fcc50953fe191d72f70f3eb353acd0d9cbc0e824793a177a6f955ec5`
  and Claude zip `4960217ffc8029c5471083355f7a155f58cf821b18b1f1bca005687e0ea317e3`.
- Native Claude 2.1.322 and Codex 0.167.2 installed the public marketplace plugin
  into separate clean profiles. Installed MCP initialize reported 0.12.6 and
  bundled Node 26.13.0; private setup returned HTTP 200 and rejected foreign Origin
  with 403. These are installation/MCP probes, not real model conversations.
- Ordinary updater completed without manual recovery: checkpoint idle/applied
  0.12.6 at the exact release commit, Docker image release-0.12.6 healthy and
  container package 0.12.6, daemon PID 2821613 from retained release checkout using
  Node 26.13.0/pnpm 12.18.0. Both pre-update SQLite snapshots were mode 0600 and
  passed quick_check. Timer restored active.
- Fresh tools: daemon 0.12.6 compatible with existing chat MCP 0.12.3, active caller,
  connected hub, healthy/no issues and empty outbox. Role and canonical feedback
  subscriptions survived. Main fast-forwarded with user changes preserved and a
  fresh private backup. No in-place MCP process upgrade is claimed.
- #9 and unproven historical #19 triggers remain open; the controlled registration
  race is fixed. Day-long, physical-subnet, unattended-reboot, native Work/wake,
  real migration conversations and other-platform gates remain separate.


## 2026-11-12: resumed 0.12.6 reliability investigation

Loaded MCP, daemon and hub 0.12.6 verified with an active caller, contract 3, both
canonical feedback subscriptions and empty local outbox. Early failed Codex hook
observations were followed by successes; the old root had retired on process exit.
The exact ordering relative to MCP re-registration is unverified. The coarse failure
records cannot prove the exact exception.

Latest main/merge CI supplied eight successful phase samples (87.330–121.401 ms),
not a reproduction of #9/#19. Separate diagnostic invocations do not explain earlier
untraced gate failures. Local and remote hub interruptions overlap kernel high-order
allocation failures; causation remains under investigation. Sixty bounded loopback
requests returned the expected unauthenticated HTTP 401, 1.527–63.300 ms. This is
endpoint responsiveness, not authenticated E2E or a day-long acceptance result.

See [research](../docs/sdlc/runtime-reliability-followup/research-brief.md),
[incident](../docs/sdlc/runtime-reliability-followup/incident.md) and
[evidence](evidence/2026-11-12-runtime-reliability-followup.json). No runtime code,
identity fences, queue contents, hook timers, kernel settings or network exposure
changed. No new release or code-test pass is claimed for this documentation work.

## 2026-11-13: mutation reconciliation qualification

Candidate 0.13.0 implements a bounded schema-4 local observation journal and operation_status
for MCP send/explicit ack. Independent correctness/security, external review and QA passed.
Final ordered build/typecheck and release qualification passed 647 workspace and 140 script
tests, dependency audit, export integrity, clean-PATH startup/setup and synthetic exported
E2E. Actual built MCP tests exercise Claude and Codex production preparation paths and
production IPC, including lookup while a timed-out mutation remains pending.

The first release gate passed tests and smokes but failed exported owner-2 set_status with
an IPC timeout. Both Claude registrations were intact. One diagnostic replay passed 61
tool calls (set_status 95.0–121.0 ms); a subsequent full release gate passed. Neither pass
establishes the original cause. Issue #25 retains the missing per-IPC failure evidence.
No timeout increase, blind mutation replay or code workaround was applied for that failure.

New implementation-history secret scan had no findings. Export scanning flagged two
release.json manifests; both contain only validated runtime metadata and content hashes,
verified against their 191 payload files. No credential fields were present. These were
triaged explicitly rather than treated as a clean raw scanner exit.

See [versioned evidence](evidence/2026-11-13-mutation-reconciliation.json) and
[review](../docs/sdlc/mutation-reconciliation/review-change-3.md). Public download/native
installation and production deployment are not claimed by this candidate qualification.
Availability #22, historical #9/#19 triggers and day-long/subnet/reboot/native-wake gates
remain open. Source schemas, replay authority and hook 140/90 ms deadlines remain intact.

## 2026-11-13: 0.13.0 publication and local rollout

Release source 983df24aa9c6d0361a81e6ebf495397263f73a3a passed branch, PR and tag CI;
PR #24 merged at 92246f06bfe33a64b9a570e58c8b581aa714c15d. Exact archives were published
before catalog merge and downloaded anonymously with matching SHA-256 sidecars. Real
clean-profile Claude Code 2.1.323 and Codex CLI 0.167.2 installations launched MCP 0.13.0,
exposed operation_status, used Node 26.13.0 and passed private setup/origin rejection probes.
The Codex CLI reported its expected temporary-home helper-alias warning; installation and
MCP probes succeeded. These are synthetic installation probes, not real model conversations.

The updater timer was stopped, active updater drained and exclusive lock verified free
before publication. Ordinary deployment completed without manual recovery: hub package
and daemon 0.13.0, healthy container, connected hub, active caller and empty outbox. The
hub restarted at 00:20:53 UTC and agentd at 00:20:59 UTC. Both pre-upgrade backups passed
quick_check with mode 0600; live daemon schema 4 also passed quick_check. Checkpoint is
idle/applied 0.13.0, timer active. The existing chat MCP remains compatible 0.12.6; no hot
update or new-tool availability in that old process is claimed.

The release was announced in kommutator-feedback. Main was fast-forwarded after a fresh
backup; all three user-local files remained byte-identical. The merged feature worktree
was removed; the retained deployment checkout remains in place. See
[rollout evidence](evidence/2026-11-13-mutation-reconciliation-rollout.json). Issues
#9, #19, #22 and #25 remain open with the qualification limits recorded above.

## 2026-11-13: Hono dependency refresh qualification

Candidate 0.13.1 updates only the MCP SDK transitive Hono 4.13.13 -> 4.13.18 and
@hono/node-server 2.1.5 -> 2.1.8 resolutions. Full audit reports zero known advisories.
Independent correctness, security and external reviewers approved; QA independently
passed 18 process tests and both exported clean-PATH smokes. Exact-version ordered
build/typecheck, 647 workspace tests, 140 script tests and the full packaging/synthetic
exported E2E gate passed without a failed local run. No application authority/schema
change or availability-root-cause resolution is claimed. Public installation/deployment
remain separate gates at this commit. See [evidence](evidence/2026-11-13-hono-security-update.json)
and [release notes](../docs/sdlc/hono-security-update/release.md).

## 2026-11-13: 0.13.1 publication and local rollout

All exact release-commit branch/PR/tag checks passed. Public archives and hashes were
verified before catalog merge; clean-profile native Claude/Codex installs launched MCP
0.13.1 and passed setup/origin probes. All seven Dependabot alerts report fixed.
The ordinary updater completed without manual recovery after timer stop, updater drain
and lock verification: hub/daemon 0.13.1 healthy, connected, active caller, empty outbox.
Backups and live daemon DB passed quick_check; timer restored, checkpoint idle. Loaded
chat MCP remains compatible 0.13.0. Release announcement sent to kommutator-feedback.
See [rollout evidence](evidence/2026-11-13-hono-security-rollout.json).

New field reports were reviewed and recorded in issue #22. The 00:20:53 UTC error cluster
coincides with the previous planned hub restart; other reported heartbeat/ack/send failures
remain unexplained. Source confirms any hub RPC timeout terminates the shared WebSocket;
that mechanism does not prove why a particular response was missing. Remote daemon 0.12.5
cannot retrospectively provide the operation ID added in 0.13.0. Idle delivery measurements
were from capability hook; the reporter confirmed fallback policy. Native-wake setup
clarity is tracked separately, without globally enabling inbound acceptance.

## 2026-11-13 — Feedback usability 0.14.0 candidate

Independent architecture, correctness/integration, security and QA qualified @project snapshot routing, strict MCP schemas and additive health_details. Exact-version build/typecheck, 674 workspace and 142 script tests, release packaging, clean-PATH and synthetic exported E2E passed. Actual schema-6 reader rejected an isolated schema-7 database without losing its retirement record. Source secret scan clean; two runtime manifest findings verified as payload hashes. Public installation and local rollout pending. External code lens was not retried after prior worker transmission denial; internal reviews are recorded, not substituted claims of external approval. Earlier implementation gate initialwhoami Shared daemon unavailable remains unexplained; later passes do not close issues9/19/22/25 or environmental gates. See [evidence](evidence/2026-11-13-feedback-usability.json) and [review](../docs/sdlc/feedback-usability/review-change-2.md).
