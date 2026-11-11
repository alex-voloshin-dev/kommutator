# Runtime toolchain refresh execution

## Scope and authorization

On 2026-11-11 the operator requested execution of the approved plan after dependency
phases 1–3. Work uses an isolated branch based on `1ce33226d4a0d83d209e8924d3b0fa92907e3d1c`.
The active contributor checkout and its uncommitted notes remain untouched. Publication,
local deployment and reporting follow the plan gates and existing operator mandate.

## R0 — Accepted baseline

The preceding dependency change was independently reviewed and QA-tested. Its local
qualification passed frozen install, ordered build/typecheck/test (520 tests), complete
release qualification (116 script tests, plugin export/smoke/synthetic E2E), audit and
non-root isolated Docker smoke on Node 24.22.2 / pnpm 10.34.9. GitHub Release checks and
Secret scan also succeeded for exact revision `1ce33226d4a0d83d209e8924d3b0fa92907e3d1c`.
The baseline lockfile remains committed at that revision. The accepted upstream PR is #6,
stacked on reviewed feedback reliability PR #5. Neither acceptance nor a green source
build asserts publication or live deployment.

## Execution status

R1 passed independent review/QA and the external lens. A minor missing project LICENSE
in the production Docker image was identified and added to R2/R3 scope. R2 implementation
is now authorized by the completed gate. PRs #5 and #6 are merged at `4696264`.


## R2 — Synchronized implementation

Runtime pins, matching types, build targets, exporter metadata, CI and Docker use Node
26.13.0 / pnpm 12.18.0. Exact version/commit cutover constraints, asset verification and
actual runtime checks precede service activation. DESIGN §19 records the contract.
Only esbuild lifecycle execution is approved. The final hub image now includes LICENSE.

Build/typecheck and a full repeat passed 520 tests. Initial hook diagnostic-observation
failure passed isolated and full repeats; no deadlines/assertions were relaxed. QA added
five process/artifact boundary tests. Both internal review lenses and external round 2
approved; regenerated hosted catalogs passed local consistency verification.

Retained candidate paths are `/tmp/kommutator-v0.12.0-candidate-export` and
`/tmp/kommutator-v0.12.0-candidate-assets`. These are preparation outputs, not publication.
R3 must qualify the frozen source and retained bytes before publication or local activation.

R2 full release:check passed on Node26: 520 workspace tests, 134 script tests, audit,
export smoke and synthetic E2E. Candidate catalogs pin tar SHA256
`a188b13426cdd89cbc773f798555780c059c178f039e48f806f3a69705ef71bf` and Claude ZIP
`4b0c3aefe3e01b3d0d620273ba4b9a51ec330f3bb671e66fc187e5d8b3e0914e`.
