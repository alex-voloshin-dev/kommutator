# Initial public source launch

Prepared 2026-10-31 at the user's request to create public
[alex-voloshin-dev/kommutator](https://github.com/alex-voloshin-dev/kommutator), check source
and history for security-sensitive material, and simplify deployment. MIT and English
public documentation remain the publication baseline.

## Delivered changes

- A short [quickstart](../../QUICKSTART.md) separates the hub operator from client users.
  The default hub starts with `sh scripts/hub.sh up`; status, bounded logs, backup, setup
  and stop use the same helper. Docker/Compose and system-tool prerequisites are explicit.
- The helper preserves key/data and existing containers, fixes UID/GID on every invocation,
  rejects custom/foreign deployments and stays on loopback TCP 8787. It never exposes LAN
  automatically. Human-only key-copy/editor instructions avoid printing credentials in chat.
- [Distribution research](research-brief.md) and the [public plan](../../DISTRIBUTION.md)
  recommend versioned bundled-client GitHub Release assets and a public GHCR hub image
  pinned by digest. These are separate future releases, not existing downloads or listings.
- Public source/plugin metadata points to the intended account. Local marketplace users
  are told to retain their extracted artifact directory.
- Gitleaks CI scans complete history with a pinned verified binary and narrow fixture
  exceptions. GitHub secret scanning/push protection, Dependabot and private reporting are
  enabled, with read-only default workflow permissions.
- Security auditing drove real dependency updates: Zod 4.6.7, Vitest 4.1.12, tsup 9.0.0 and
  esbuild 0.28.2. Development requires Node 24.11+ in the Node 24 line. The lockfile was
  regenerated intentionally; full audit found no known vulnerabilities.
- Zod compatibility work preserves record schemas, strictness and omission of wake/capability
  updates. CLI schema/workspace bundling and namespace imports recover cold-hook startup
  headroom; hub assets and ws remain external. No hook deadline or assertion was weakened.

## Observed checks

Independent QA on Node 24.22.1 / pnpm 10.18.0 passed the full release gate: build/typecheck,
328 workspace tests (33 protocol, 141 hub, 50 daemon, 104 CLI), six verifier tests and 11 hub
helper tests. Export checksums/licenses/identity, both clean-PATH plugin smoke clients and
synthetic messaging/lifecycle/offline-queue E2E passed. Full dependency audit was clean.

Docker 29.9.2 built the final source under a separate image tag. All 18 disposable smoke
checks passed: authentication, isolation, messages/read receipts, online backup and overwrite
refusal, recreation persistence, stop/restore, crash recovery and bad-secret rejection.
Temporary Compose resources were removed. The existing hub container and local image tag
were unchanged. Docker testing and hook timing tests were run sequentially to avoid load
interference. There was no deployment of the new image to the existing live hub.

Independent [code review](review-code-1.md) and [security review](security-review.md) approved.
The [research skeptic](review-research-brief-1.md) approved cited recommendations. Optional
external CLI reviews produced no parseable result and are not counted as approvals.

Work used an isolated source snapshot; no original private development history was created
or imported. The final publication process inspects the exact source manifest, scans the
first committed history before push and checks a fresh remote clone. No vendor tokens,
runtime databases, keys, generated dependency trees or plugin binaries belong in Git.

## Limits

No fifth-grade user study was performed. Usability evidence is the shortened instruction
path, independent reader review and executed setup/error/lifecycle tests. Installing Docker,
configuring optional LAN access and client hook trust still require the user's actions.
Binary releases, GHCR publication, vendor directory acceptance, real migrated-plugin
conversation, other platforms, external-subnet access, reboot and day-long use remain
separate work. A passing scanner/audit does not guarantee absence of every security risk.
