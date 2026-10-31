---
type: review
target: Initial public source, installer, dependency and secret-scanning boundaries
iteration: 1
verdict: approve
findings: []
---

The independent security reviewer approved the final source and installation/scanning
changes. Targeted text review, all seven remaining PNGs and their metadata, 17 curated
JSON evidence files, authentication/setup code, Compose and LAN boundaries were inspected.
No confirmed private credential or unredacted workstation path was found. This is bounded
review, not a proof that vulnerabilities cannot exist.

The parent compared candidate bytes against actual locally stored hub/client credentials,
GitHub authentication material and SSH private-key content without printing those values.
No match was found. Initial default Gitleaks 8.30.1 scanning produced seven findings; each
was reviewed: six synthetic smoke/test token occurrences and one message replay UUID.
The committed allowances require the exact path and value and only affect generic-api-key.
Planted synthetic credentials were still detected inside an allowlisted file and elsewhere;
an allowlisted value at an unrelated path was also detected. No whole test/evidence
folder is excluded from detection.

Dependency auditing found GHSA-mrhx-c7xc-m3w5 in the old Zod version and additional advisories
in development tooling. The final tree uses Zod 4.6.7, Vitest 4.1.12 and tsup 9.0.0 with
esbuild 0.28.2. Full audit returned zero known vulnerabilities. Oversized collection early
rejection and omission-preserving update semantics have regression tests; hook deadlines
were not relaxed. Application imports do not use zod/v3 compatibility mode.

The default installer keeps state outside the checkout, rejects unsafe state paths and
foreign deployments, serializes commands and creates keys without overwriting them.
It binds only loopback TCP 8787, preserves existing containers and does not change firewall
rules. Independent tests exercised those boundaries. Actual disposable Docker checks passed.

Initial history was absent. Publication requires scanning the exact selected source files
and every reachable Git commit before push, then verifying a fresh remote clone. Scanner
reports and local credential data stay outside the repository. CI scans complete history
with a pinned, checksum-verified Gitleaks binary and redacted output. GitHub secret scanning,
push protection, Dependabot and private reporting were enabled on the new public repository;
workflow token defaults are read-only. These controls supplement, not replace, review.

No network penetration test, real vendor migration or external-subnet/reboot/day-long
acceptance was claimed. HTTP/WS remains restricted to the documented trusted-group scope.
