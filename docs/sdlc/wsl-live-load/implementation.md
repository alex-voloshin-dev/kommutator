# WSL Docker live-agent load check

Observed 2026-10-27, successful session interval **11:02:05–11:08:26 UTC**. **Passed for three real local Claude sessions and a bounded concurrent
workload**, not a capacity/saturation benchmark or remote LAN acceptance.

## Environment and isolation

The existing kommutator-hub-1 Docker container stayed running on 127.0.0.1:8787 throughout.
It had about 34 hours uptime at the start. Claude Code 2.1.310, Node v24.22.1, and the shipped
plugin, MCP shim, hooks and per-host daemon ran in WSL2 Ubuntu. Three independent Claude
stream-json processes used one scratch cwd/project, an isolated KOM_HOME and a unique host
ID. Built-in tools were disabled; the only MCP server was kommutator. Launch-scoped inbound
accept and KOM_CLAUDE_INBOUND_POLICY=accept were explicit; no global/repository policy or
hook settings were edited. Session persistence was disabled for this test.

The initially selected default model, claude-fable-5-1, rejected all three initial turns
with usage-credit exhaustion. Those processes registered with the hub and connected MCP,
but sent no messages; they exited and their private daemon was stopped. A Sonnet probe
returned OK. Three fresh sessions then used claude-sonnet-5-5 successfully. This was a
model-account limitation, not a hub transport/auth failure. No quota/billing settings changed.

## Workload and observed results

| Check | Observed result |
| --- | --- |
| Three sessions in one cwd | atlas, boreas and cirrus had distinct hub IDs; each vendor_session_id matched its launched Claude UUID |
| Native idle wake | All three were idle; only atlas received an operator send prompt. Boreas autonomously read and replied in a new turn without intervening operator input |
| Initial round trip | 9.661 seconds from request commit to reply commit, correct reply_to/thread_id |
| Concurrent ring | Each of three sessions sent three requests to the next agent; all nine received exactly one corresponding reply |
| Total traffic | 22 messages: 11 requests and 11 replies, including a final post-exit exchange |
| Integrity | No missing or duplicate replies, all sender/recipient and thread links correct, per-recipient delivery sequences gap-free |
| Read state | All 22 marked read; all 11 request bodies explicitly read; 19 of 22 total bodies explicitly read |
| Shared board | atlas created roundtrip v1; all three obtained identical version/body/author from actual board_get results |
| Exit survival | After atlas exited, the same daemon PID 919243 served the remaining agents, hub stayed connected, outbox stayed 0 |
| Post-exit message | boreas sent to idle cirrus; cirrus autonomously replied, then boreas read the reply |
| MCP results | No tool errors in the successful run; all 22 sends returned sent |
| Dashboard transport | Live SSE delivered message/delivery/read/board events; snapshot API stayed valid |
| Container | healthy throughout observed checks; final restart count 0 and OOMKilled=false |

All replies included the expected marker and request identifier. The three PONGs delivered
to cirrus during the burst were marked read by hook-shown headers without a full-body read.
This is allowed receipt semantics; it is not a claim that all agents explicitly opened every
body. Receipt state alone was never used to establish native wake or completed round trips.

Request-to-reply time across all 11 exchanges: min **6.588 s**, median **9.261 s**, max
**11.321 s**. This includes Claude inference/tool execution and wake scheduling, not just
hub transport latency.

During the concurrent phase a separate read-only HTTP burst issued **200 authenticated
snapshot requests with concurrency 8**: 200 passed, no errors, p50 **9.11 ms**, p95 **21.66 ms**,
max **73.69 ms**, total burst duration **360.46 ms**. This short loopback burst does not
establish sustained throughput. 81 periodic Docker samples recorded RAM **34.62–48.71 MiB**
and a sampled CPU maximum **30.78%** in Docker's CPU metric. Sampling can miss shorter peaks.
No host/application memory limit or maximum safe agent count is inferred.

## Evidence and cleanup

[Sanitized evidence](../../../spikes/evidence/2026-10-27-wsl-docker-live.json) contains actual
assistant tool calls/results (without hidden reasoning), server message events, delivery
records, metrics, model-failure information, idle/survival snapshots and cleanup facts.
Deterministic assertions cross-checked 22 unique messages, 11 unique paired replies, exact
reply bodies, thread/recipient identity, all request-body reads, gap-free sequences, board
identity and daemon continuity. The export was checked against the real hub key; it contains
no key, vendor messaging tokens or hidden-thinking blocks.

All three successful Claude processes exited 0, their private daemon was stopped, and the
hub reports all test sessions gone. The earlier failed-model processes also exited.
Private scratch config/state and harness files were removed after export. The production
container remains healthy. Test message/board history is intentionally retained in the hub
under project **load-20261027-pxexzxtq**, host **wsl-live-pxexzxtq**. Prune/delete was not used.

No production code or runtime configuration changed. Only evidence/documentation changed;
workspace unit tests were not rerun for an execution/evidence-only task.

## Limits and next acceptance

This closes local WSL Docker live-agent messaging/native idle-wake, shared-board and
session-exit checks for the recorded model/version/policy. It does not establish remote
LAN/second-host access, interactive TUI/browser rendering, a hub or Windows reboot,
full Codex integration, saturation capacity or step 7 day-long normal usage. The existing
34-hour mostly idle container uptime is not the full-day real-use criterion. Next: actual
remote-client/LAN acceptance and the separate day-long observation.
