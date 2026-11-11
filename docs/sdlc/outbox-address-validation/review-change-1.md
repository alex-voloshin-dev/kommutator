# Outbound address validation review

New sends use the existing parser before persistence in MCP, agent and human paths.
Historical message schemas and reads remain permissive. No address correction, recipient
lookup, queue pruning, replay changes or database migration is introduced.

Independent correctness and security reviewers approved the final code. Security review
found that a continuable length error could still echo oversized input through the parser;
the final schema skips that parse and uses bounded guidance. Protocol documentation now
correctly distinguishes MCP syntax guidance from generic raw RPC validation errors.

QA approved ordered build, typecheck and 533 tests (protocol38, hub176, agentd105, CLI214).
The direct hub-routing fixture was corrected to bypass the new send schema, retaining its
routing fault and no-persistence assertions. Historical compatibility is also checked through
the actual message.read result schema. Ten hook measurements were 132.991–191.267 ms.

External review initially rejected incomplete release catalogs and the documentation wording.
After documented packaging regeneration and the wording fix, final external review approved
with no findings. Source diff secret scan passed. Artifact scanning found two generic-key
matches in runtime/release.json; both contain only runtime metadata and 189 independently
verified payload SHA-256 entries, not credentials.

A subsequent release-check run failed the stalled-observation SessionEnd process test:
whoami unexpectedly remained available after SessionEnd. Both hook durations were below
200 ms. Two focused repeats passed without changes; lifecycle source, test and lockfile match
v0.12.1, but changed shared-schema loading means baseline causality is not established.
Issue #13 tracks the authority-retirement boundary separately from latency issue #9.
The original failure is retained; one bounded full qualification repeat follows.

The bounded release-check repeat passed all 533 workspace tests, 134 script tests,
frozen install/audit, export verification and clean-PATH setup/cache smoke. Its final
synthetic E2E failed a 2-second owner-hook fixture watchdog without identifying the event.
A focused retained-export run with temporary event/exit diagnostics passed every phase;
no root cause is established and neither watchdog nor hook budget was increased.
The tracked fixture is being given bounded timeout diagnostics before exact-source E2E.
Full history scan: 57 commits, no leaks. Neither failed aggregate run is reported as passing.

Superseded local staging assets (never published):
- Linux tar SHA-256: d54dfba8a4cd307dc83a6c479684ecd1dcff003196f3e2d3176f69597f5f9f1b
- Claude ZIP SHA-256: 745fab0fb1826c5ec45f412e126258da8a68d72adb3f9ee36570cbe8f91d6b1e

Further qualification reproduced the hub-state failure in the tracked export E2E. An
initial lifecycle correction moved generation retirement before delivery imports and passed
15 focused tests plus independent correctness/security/external review. Final full QA then
passed 533 of 534 tests: local retirement succeeded, but the newly independent hub-gone
assertion still failed after one second. All 12 hook measurements remained below 200 ms.
The release remains held while durable reconciliation of the existing generation-specific
end marker closes the separate lost-notification recovery gap. No failed gate is waived.

Final recovery review approved after two additional corrections: durable markers override
recoverable liveness retirement before same-generation registration, preserving queued replay
keys; diagnostic status triggers background recovery without waiting for marker probes or hub
acknowledgements. A new retired-locally observation reports committed local retirement without
claiming delivery. Independent correctness, security and final external reviews approve.

A subsequent pre-final QA run passed 544/545 tests: the existing delayed-SessionStart test
did not observe its instrumented delivery-import marker (ENOENT). Its later authority
assertions did not run; this does not establish registration failure. Two measurements
exceeded the 200 ms target but remained below 300 ms. Final isolated qualification follows
after all review processes have stopped; no timeout or assertion was relaxed.

Final staged assets (fresh export after all source changes):
- Linux tar SHA-256: a9ace9c5a9c4eebe6add69aa0f41c271a306b1bc8717f2b1f0bc9f9a0e7d202f
- Claude ZIP SHA-256: 56818f84c8c3f9bceff29629034eaf987e25cbd2e1486bf5a6dec1b4bfe7155b

Final export scan again found only the two runtime manifest checksum matches; all 189 payload
hashes in each manifest were independently verified. Final source diff scan passed.

Final isolated `pnpm release:check` passed (exit 0): frozen install/audit, ordered build and
typecheck, 552 workspace tests across 45 files (protocol 38, hub 176, agentd 118, CLI 220),
134 script tests, export verification, both clean-PATH setup/cache smokes, and every synthetic
export E2E phase. All 12 workspace hook measurements were 115.193–182.817 ms. No live vendor
or other-platform acceptance is implied. Intermediate failures above remain recorded.
