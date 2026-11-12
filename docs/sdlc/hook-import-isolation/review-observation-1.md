---
type: review
target: hook-import-isolation-observation-contract
iteration: 1
verdict: approve
status: draft
review_decision: revise
findings: []
---

# Observation contract correction — round 1

Independent correctness/integration review and the external CLI lens approved
without findings. Eight focused tests passed. The process rejection test preserves
exact hello-only IPC, fail-open output, absent hub registration and no false
success. A separate deterministic real hook/storage test requires final failure
persistence without the independent entrypoint deadline.

QA: one full 0.12.5 release check failed a different semantic SessionEnd assertion
(573 workspace passed, one failed). Original cause unknown. Build/typecheck
passed; script/export stages were not reached. No release or deployment.
See observation-contract-correction.md and spikes/RESULTS.md. Gate remains red.
