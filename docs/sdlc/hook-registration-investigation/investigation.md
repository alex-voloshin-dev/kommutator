# Hook latency and registration investigation

Date: 2026-11-12. Runtime 0.12.5, Node 26.13.0; source commit
`4d0602f922d91692c66e4bb00799f336ab59070a`. No production behavior, timers,
identity fences or live services were changed. All experiments used private synthetic
hubs, homes and owners. Historical CI remains a separate observation.

## Issue #9: measured scheduler contribution

Two bounded interleaved series collected 80 hook samples: 48 across manual cold
SessionStart, plugin SessionStart and responsive Codex Stop, then 32 manual cold
samples with reversed trace/control starting order. The first series contained an
untraced 310.501 ms manual cold outlier; its internal phases are unknown, and it
exceeds both the 200 ms target and temporary 300 ms test limit. This diagnostic
runner records observations; it is not a passing release gate.

The second series captured a natural traced 207.380 ms manual cold outlier:

| Boundary | Milliseconds since parent spawn call |
| --- | ---: |
| Parent spawn event | 7.241 |
| Preload mark | 87.659 |
| JavaScript entrypoint | 90.204 |
| Delivery import start / end | 93.155 / 162.795 |
| runHook start / end | 162.801 / 197.178 |
| Child exit event | 197.604 |
| Parent close event | 207.380 |

Linux `/proc/self/schedstat` recorded 38.327 ms cumulative main-thread runnable
wait at preload and 54.349 ms at exit. Other traced samples in that series had
0.000–8.416 ms cumulative wait. Thus CPU scheduling delay is a directly observed
contributor to this outlier, including time before the 140 ms entrypoint deadline
can start. The hook completed normally; the deadline did not fire. No major page
fault or block input operation was reported for that child. This does not rule out
all filesystem or loader costs, nor identify the competing process or scheduler cause.

Do not add scheduler wait to wall duration: it is already part of elapsed time.
`schedstat` describes the main thread, while resourceUsage CPU totals cover the
process. Preload/loader tracing perturbs execution; paired samples do not establish
a per-sample overhead correction. There is no basis to attribute every historical
222–271 ms CI result, or the untraced 310.501 ms sample, to this measured contributor.

## Issue #19: demonstrated registration race

The original issue concerns the manual absent-socket lifecycle fixture's first
whoami, not the later plugin generation/retirement failures. A traced baseline
passed. A loader then injected a 200 ms asynchronous delay at daemon registerOwner
entry, before local record creation. This is a controlled delay, not a measurement
of slow ps or evidence that the original process-birth probe took 200 ms.

| Control | Hooks, parent elapsed ms | Original identity assertion |
| --- | --- | --- |
| No injected delay | 174.174 / 144.967 | Pass |
| Delay before local registration | 196.363 / 186.586 | Exact original missing-registration error |
| Delay only hub session.upsert | 195.741 / 192.643 | Pass |
| Registration delay, diagnostic-only later snapshot | 191.680 / 183.770 | Still failed; record later appears |

In the registration-delay control, both hooks sent ipc.hello, hit the unchanged
140 ms deadline and exited fail-open before registration completed. Immediate MCP
binding observed the missing reviewer record. A snapshot 400 ms after the failure
found both records active without another hook or identity-call retry. Accepted
registration continues after hook disconnect; ownership uses the live parent PPID.

The source ordering explains the observation: core.register serializes registration;
registerOwner awaits process birth/project/retirement checks before saving the local
record. Shim binding does not wait for that in-flight registration and resolves the
current registry snapshot. Hub flush follows local registration, which explains why
the hub-only control did not reproduce the missing-local-record error.

This proves a sufficient race mechanism below 200 ms, independently of #9. It does
not prove which prerequisite or scheduling boundary delayed the original CI run.
The artificial failures were retained as expected failures, not retried into passes.
No claim is made about the separate missing-generation publication failures.

## Decisions and next evidence

Keep #9 and #19 open. Do not increase timers, accept exit zero as registration,
weaken assertions, invent an identity or introduce unbounded retries. A larger
process-test threshold cannot fix the demonstrated semantic race.

Next capture daemon-side accepted hello, registration queue entry/start, process-birth
completion, local save and hub flush alongside the hook deadline in the failing
CI fixture. Use fixed phase names, synthetic owner labels and relative times only;
retain evidence on failure. A possible bounded wait for an already accepted exact-owner
registration requires an explicit recovery contract and generation/retirement/security
review before implementation. It must not register a shim without genuine hook authority.

For #9, preserve parent/child boundaries and Linux scheduling counters when available.
An OS scheduler does not provide a hard whole-process wall-clock guarantee; the
application can still reduce avoidable startup work, but further optimization needs
an observed expensive phase rather than treating every overrun as application CPU.

## Evidence

- `spikes/evidence/2026-11-12-hook-scheduler-investigation.json`: all 80 samples,
  artifact and harness hashes, phase marks and scheduler counters.
- `spikes/evidence/2026-11-12-registration-race-investigation.json`: four controlled
  runs, injection descriptions, hook phases and harness hashes.
- Local exact harnesses and logs: `/tmp/kommutator-issues9-19-20261112/` and
  `/tmp/kom-issue19-investigation/`. Phase clocks differ: scheduler samples use
  monotonic cross-process timestamps; registration hook phases start at preload.
