# Technical design review round 2

Verdict: approve. Independent internal architecture/security review found one
major: key-only CAS misses remote changes. Full-record revision under lock
resolves it; internal re-review approved. External lens approved with two minors:
full-record CAS (already fixed) and vendor-specific activation. The latter is
clarified: Claude needs a new OS owner; existing Codex root retains identity
across shim replacement, so selection needs a new independent root. No alias,
board merge, history rewrite or in-place seat migration is promised.

Implementation criteria retained: descriptor-based private-file validation,
exclusive0600 temporary files, verified private directory, owned lock release,
no age/PID-based automatic stale-lock removal, intentional-remote-change tests.
Design and ADR validate; implementation and independent code/QA remain pending.
