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
