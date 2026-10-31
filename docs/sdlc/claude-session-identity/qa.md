# Claude session identity QA

Observed on 2026-10-31, Linux x64 / Node 24.22.1 / pnpm 10.18.0.

## Regression and coverage

The exported-plugin E2E now launches two synthetic vendor parent processes, each spawning
the actual exported `bin/hook` and `bin/mcp`/bootstrap. Both owners use the same Claude
vendor session ID and working directory. No owner PID is injected by the test: real process
ancestry supplies it. Both SessionStart hooks run before the daemon exists.

The test requires distinct hub IDs and handles, three rounds of independent status/role
updates without incarnation churn, and bidirectional DM inbox separation. Both hook-only
owners then remain live across a bounded 21-second wait spanning the daemon's default
20-second sweep, without hooks that could mask a mistaken end/re-registration. Their IDs,
incarnations and statuses must remain unchanged. Ending owner B
must mark B gone, reject B's later `whoami`, and preserve A's ID, incarnation and status
after A's subsequent hook. Existing marketplace metadata/manual-conflict, cross-vendor
messaging, topic/board, runtime-cache removal, daemon restart and offline queue checks remain.

The same harness against the previously qualified **0.2.1 export failed** at
`Concurrent Claude processes sharing a vendor ID need separate hub identities`:
`actual` and `expected` hub IDs were identical. This reproduces the reported failure
without changing the user's sessions or hub. The candidate export passed the full harness.

Local diagnostic logs (temporary files, not release artifacts):

- `/tmp/kom-claude-identity-old-e2e.log`: old-artifact negative control, expected failure.
- `/tmp/kom-claude-identity-new-e2e.log`: candidate full exported E2E, passed.
- `/tmp/kom-claude-identity-release-check.log`: initial candidate gate, passed but superseded.
- `/tmp/kom-claude-identity-release-check-final.log`: final corrected 0.2.2 gate, passed.

## Final release gate

After the lifecycle review corrections and hook-only liveness fix, fresh build, export
and packaging, `pnpm release:check` completed successfully and sequentially:

- Frozen-lockfile install and dependency audit: no known vulnerabilities.
- Release-version and hosted catalog/launcher checks.
- Workspace build, typecheck and **372 tests**: protocol 33, hub 141, agentd 67, CLI 131.
- **29 script tests**.
- Fresh export integrity/license verification, clean-PATH MCP/private-setup smoke for
  Claude and Codex, and the full exported E2E described above.
- `git diff --check`: passed.

An earlier engineer-run workspace attempt reported two unchanged hub timing-test failures
while artifact compression overlapped it. That attempt is not counted as a passing gate;
the final sequential release gate above passed all 141 hub tests and the entire workspace.
No assertion or timeout was weakened to obtain this result.

The first candidate passed its then-current 360 workspace tests, but review found a
lifecycle TOCTOU issue; further inspection also found hook-only sweep liveness needed
correction. That candidate and its artifacts are superseded. Additional regression tests
and the final gate above cover the corrected implementation. Review approval is recorded
separately; passing tests alone were not treated as approval.

## Prepared final artifacts

Packaging generated the hosted catalog pins from these exact 0.2.2 artifacts:

| Artifact | SHA256 |
| --- | --- |
| `kommutator-v0.2.2-linux-x64.tar.gz` | `e0d572357c92e38a1c598a781e027d5d80cc1000eb29c2e96b345d4afd274f36` |
| `kommutator-v0.2.2-claude-linux-x64.zip` | `8c10a10a90f5ad488dfe32bb7602d73d18703f11559ea523cbf7e12601680a51` |

Prepared under `/tmp/kom-claude-identity-release-022-final`; source export is
`/tmp/kom-claude-identity-export-022-final`. These exact artifacts replaced the initial
candidate in the generated catalog pins. This checkpoint records preparation, not
publication.

## Evidence limits

These are synthetic MCP/hook clients with real process ancestry, not a live Claude
application acceptance run. The reported remote computer's two sessions still require
an installed-client update and observed independent `whoami` responses. Native wake,
other operating systems, separate-host subnet acceptance, reboot and day-long usage are
not established by these tests.

## Publication security checks

Source Gitleaks scan and comparison with known local credentials passed. The
403-file final plugin export also contains no known local credential values or
their base64 forms. Artifact Gitleaks reported two inventory matches: the same
`path-key` license SHA256 in each vendor's `runtime/release.json`. Both were
verified against the actual license bytes and finding locations; they are
checksum values, not credentials. No broad scanner exclusion was added.
