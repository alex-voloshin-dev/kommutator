---
type: review
target: github-client-plugins
iteration: 2
verdict: approve
findings: []
---

# GitHub client packaging review

Independent correctness/integration and security reviewers approved the final source and
exact release artifacts. The first review identified that Claude's 30-second MCP startup
limit made a first-start large download unreliable. The final implementation uses Claude's
native pinned-ZIP installation; Codex retains its bounded bootstrap with a 180-second
startup allowance. The revision also fixed the maintainer version/regeneration ordering.

The security reviewer checked HTTPS-only download, fixed validated release identities,
SHA-256 verification before extraction, private owner-checked directories, regular lock
files, atomic concurrent installation, and hooks that never install or acquire locks.
Both reviewers inspected archive contents, executable modes and source/catalog hash
agreement. Cached executables remain trusted to their local owning user.

No protocol, identity, receipt, wake policy, hook deadline or live host settings are changed.
An external CLI reviewer was attempted separately; any timeout/unparseable response is not
counted as review approval. Full QA and actual public installation evidence are recorded in
[implementation](implementation.md).
