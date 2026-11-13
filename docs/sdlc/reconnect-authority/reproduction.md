# Reconnect failure reproductions

Observed 2026-11-13 using Node 26.13.0. The authority experiment below uses the
retained deployed 0.14.0 bundle at commit `63ffa4bd5ed7213c1b706511e60ea7d3b2c04033`;
its bundled `RELEASE_VERSION = "0.14.0"` was verified before execution. The startup
experiment bundles source matching baseline `99fd84c02c3e485d785d83302b1516952c688bef`. These are isolated synthetic experiments, not live
Claude acceptance or proof of the reporter's exact scheduling cause. No production
configuration, daemon, hub, or vendor service was used. No runtime source was edited.

## SessionStart interruption before authority publication

Executed the retained deployed CLI bundle with private HOME
and KOM_HOME directories under `/tmp`. Each hook received valid synthetic
SessionStart JSON. A Node preload intercepted either `child_process.execFile` for
`ps`, or `fs/promises.link`, delaying the operation by 500 ms. The normal entrypoint
and unchanged 140 ms deadline remained active.

| Injection | Exit | stdout / stderr | Observed duration | Durable authority |
| --- | --- | --- | --- | --- |
| None | 0 | empty / empty | 142 ms | One committed generation |
| Delay owner `ps` | 0 | empty / empty | 187 ms | No journal directory or generation |
| Delay generation link | 0 | empty / empty | 191 ms | Empty journal directory, one temporary file, no generation |

Reproducer: `/tmp/kom-reconnect-trace-v014.mjs`. Fixture artifacts:
`/tmp/kom-reconnect-trace-R6yn2v`. Bundle entrypoint:
`/home/avav25/.local/state/kommutator-release-deploy/attempts/v0.14.0-2cb11a7b-4a49-41cb-8915-66e7b6d0e32a/repo/packages/cli/dist/index.js`. These temporary paths are investigation artifacts,
not durable repository test fixtures.

Qualification correction: the initial run used the main checkout
`packages/cli/dist/index.js`, whose embedded release version was subsequently found
to be **0.12.3**, despite the checkout source being 0.14.0. Its original measurements
(normal 184 ms, delayed ps 196 ms, delayed link 189 ms; artifacts
`/tmp/kom-reconnect-trace-Gz9Iug`) must not be cited as 0.14.0 evidence. The table
above replaces that invalid release qualification with the verified 0.14.0 rerun.

The source path is `index.ts` → `prepareHook` → `saveClaudeRegistration`.
Publication awaits external process-birth probing, directory creation, legacy-context
read, directory enumeration, temporary write, and atomic link. A timer interruption
before the link leaves no committed authority. An empty journal deliberately fences
legacy fallback. `ClaudePluginClient.call` resolves authority before daemon preparation;
therefore no journal means no replay or lazy daemon start from this path. The existing
250 ms accepted-manual-registration wait does not cover generated plugin authority.

## Lazy daemon startup exceeds the retry schedule

Bundled the baseline `packages/cli/src/ipc-client.ts` with esbuild 0.28.2 into `/tmp`.
Verified `git diff 99fd84c -- packages/cli/src/ipc-client.ts` in the main checkout
was empty; this experiment uses source, not the stale main CLI bundle.
Instantiated its actual `IpcClient` with `lazyStart: true`, `timeoutMs: 5000`, and a
private Unix socket endpoint. Its injected spawn callback scheduled a synthetic
JSON-RPC listener after 2,200 ms. The listener answered `ipc.hello` and
`daemon.status`; no daemon process or hub was started.

| Attempt | Elapsed from first call | Result |
| --- | --- | --- |
| First `daemon.status` | 1,761 ms | `Daemon unavailable; check kom init and kom daemon run` |
| Second, after listener opened | 2,211 ms | Compatible status returned |

The spawn callback ran exactly once. Reproducer:
`/tmp/kom-reconnect-startup.mjs`. Machine-readable evidence:
`/tmp/kom-reconnect-startup-Bg34Cv/evidence.json`.

`IpcClient.open` retries refused/missing endpoints with six sleeps totaling 1,750 ms
(50 + 100 + 200 + 400 + 500 + 500). Its configured 5,000 ms timeout limits individual
socket/RPC operations, not this startup schedule. Thus a healthy daemon becoming
available within 5,000 ms can still fail the initial call. Source inspection shows
`pluginDaemonDiagnostics` maps this exhaustion to `unavailable`, which
`requirePluginDaemon` renders as “Shared daemon unavailable”. The experiment measured
the underlying client failure directly; it did not execute that wrapper.

This is a separate failure from missing hook authority. It is consistent with the
previous first-call failure in the delayed-delivery-import process test, but that
historical failure was not instrumented sufficiently to attribute it conclusively.

## Evidence limits and remaining validation

Neither experiment establishes that scheduler contention caused the reported live
incident. No full build/typecheck/test gate, real Claude restart, day-long, subnet,
or reboot acceptance was performed by this investigation. A fix must retain the
140 ms hook and 90 ms IPC timers, owner-birth and generation fences, and explicit
SessionEnd retirement. Recovery must not derive fresh authority from MCP launch IDs,
cwd, or the absence of a journal.

## Restart aborts on an ordinary transport close before confirming absence

Observed 2026-11-13 with Node 26.13.0 and esbuild 0.28.2. Bundled the actual
`IpcClient` and `confirmDaemonStopped` sources from the reconnect worktree, verifying
that both modules and their local dependencies matched baseline
`99fd84c02c3e485d785d83302b1516952c688bef`. Explicit esbuild aliases selected protocol
and agentd paths **source**; the saved bundle metafile was checked to exclude workspace
`dist/` inputs. No deployed CLI bundle was used.

An isolated Unix socket server under `/tmp` acknowledged `ipc.hello` and exactly one
`daemon.shutdown`. A fresh management client then completed `ipc.hello` and requested
`daemon.status`. At that point the fixture stopped listening and closed the accepted
socket normally without a status response. This models shutdown overlapping a fresh
confirmation RPC; it does not run a real daemon or claim the reporter's exact timing.

| Observation | Result |
| --- | --- |
| Server requests | `ipc.hello`, `daemon.shutdown`, `ipc.hello`, `daemon.status` |
| Shutdown requests | Exactly one |
| Actual pending status error | Uncoded `IpcError`: `Daemon disconnected; delivery state may be uncertain; do not resend blindly` |
| Baseline confirmation result | Failed after 9 ms: `Daemon stop confirmation failed; no replacement started` |
| Independent fresh probe immediately afterward | `ENOENT`, confirming the fixture listener was absent |

The baseline aborts on the uncoded transport-close error instead of issuing another
fresh status probe within its remaining two-second budget. `daemon-stop.ts` accepts
`ECONNRESET` and `-32031` as transitions, but `ipc-client.ts` represents this ordinary
socket close without a code. This establishes an actual client/confirmation integration
mismatch; it is independent of timezone-dependent birth identity and does not establish
that every real restart encounters this ordering. Close alone remains insufficient to
authorize a replacement: a fix must still obtain fresh absent-listener evidence and
must not classify malformed responses or other unrelated uncoded errors as closure.

Reproducer: `/tmp/kom-reconnect-stop.mjs`. Machine-readable evidence and the checked
esbuild input metafile: `/tmp/kom-reconnect-stop-kzUmvo/evidence.json` and
`/tmp/kom-reconnect-stop-kzUmvo/metafile.json`. These are temporary investigation
artifacts, not repository behavior tests. No production calls, runtime source edits,
or full build/typecheck/test gates were performed for this experiment.
