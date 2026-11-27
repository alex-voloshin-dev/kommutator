# Code review round 2

Verdict: approve for cfb1a53. Independent correctness/API, security and external
reviews approve the repaired implementation; external returned no findings.
The round1 stale snapshot defect was reproduced on the old core with a paused
predecessor probe and concurrent hub-ID/DND/receipt updates. Fresh owner state
and generation/lifecycle checks now follow the await, with a separate retired-
predecessor rejection control. Ordered build/typecheck and136 focused tests passed.

Initial internal reviews missed the stale snapshot issue; retain that limitation
and its baseline/fix evidence in implementation.md. Full integrated e628bc8 gate
passed910 tests before this repair and is not final qualification. Independent
QA is authorized next; any QA defect re-enters the same bounded review loop.
Codex guidance was separately independently approved and is in the integrated diff.


Independent QA95e73d2 added built CLI/malformed startup, file bounds/descriptor
controls and divergent same-key history preservation. First full QA run passed
552 tests and timed out3 agentd tests; CLI did not run. Unchanged focused218+4
passed. One ordered repeat passed916 tests. No root cause established; see qa.md.
Develop gate proceeds on reviewed runtime plus final QA, retaining earlier failures.
Exact-version release qualification remains separate and pending.

Release preparation source scan exception was independently security-reviewed:
only exact test path AND literal board key `handoff/marketing` are exempted.
No detector removal or broad path exemption. Version0.18.0 is metadata-only.
