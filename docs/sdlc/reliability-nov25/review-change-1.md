# Reliability review — round 1

Reviewed integrated head `605501a` against `bc82525`.

- Correctness/integration reviewer: approve, one minor finding.
- Security reviewer: approve, no findings.
- External read-only Codex lens: approve, same minor finding.
- Integrated build/typecheck passed. QA/full suite pending: not yet a proceed decision.

The verified minor finding is that socket close/error while `ipc.hello` is pending can
report the intended outer hook operation even though it has not been dispatched. Fix
that attribution and add a real close-before-hello-reply regression before qualification.
The core backoff guard, current-socket lifecycle fences, fixed diagnostic projection and
unchanged mutation/receipt semantics were approved. No review claims the historical
availability root cause is established.

The initial workflow used Agentic Forge 2026.11.13. Another session updated the installed
plugin to 2026.11.14 during work; the started external lens completed successfully.
Subsequent workflow tools use the actual existing 2026.11.14 installation. No plugin
approval or global setting was changed by this task.

## Follow-up review

Correctness review of `93b53c1` approved the hello-close attribution repair without
remaining findings. A second external run approved the source behavior but returned
`changes` for an actual packaging mismatch: version sync selected 0.17.0 before export
regenerated the hosted 0.16.2 catalogs. This is pending required packaging work, not a
qualified artifact. Regenerate and verify matching assets/catalogs before the final
review and release gate; do not suppress the finding.

## Final packaged-diff review

Matching0.17.0 assets/catalogs regenerated. External lens3 returned approve with no findings;
its prior packaging finding is resolved. Independent QA's ordered full workspace passed849.
The subsequent parent release gate failed three CLI cases and is retained in qa.md. Final
release qualification is pending; approval alone does not authorize claiming a green gate.

Final decision: `review-decision --verdict approve --iteration 3 --gate-green yes`
returned `proceed` after independent QA and both complete unchanged hosted release gates
passed. This decision retains the local failed packaging gate, not reclassifying it as green.
Source, final packaged diff and exact tag commit are qualified; deployment is separately checked.
