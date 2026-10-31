# Publication evidence

Observed 2026-10-31. The public repository is
[alex-voloshin-dev/kommutator](https://github.com/alex-voloshin-dev/kommutator).
The initial code commit is
[2208149](https://github.com/alex-voloshin-dev/kommutator/commit/22081494b9e99321647eccea801e6033bd4f69aa).

Before that push, the exact 255-file candidate passed Gitleaks 8.30.1 with narrowly reviewed
fixture allowances. The first complete Git history also passed, with no detected secrets.
The candidate and every reachable blob were compared against actual local hub/client keys,
GitHub credentials and SSH private-key material without disclosing them; no match was found.
An anonymous HTTPS clone succeeded and its history was scanned again successfully. Private
archives, runtime data, keys, dependencies and built plugin artifacts are not tracked.

Both hosted workflows passed for the initial code commit:

- [Full Linux release checks](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41229449995)
- [Full-history secret scan](https://github.com/alex-voloshin-dev/kommutator/actions/runs/41229449985)

GitHub reports the repository public. Secret scanning, secret push protection, Dependabot
security updates and private vulnerability reporting are enabled. Workflow token defaults
are read-only; workflows cannot approve pull-request reviews. GitHub's optional non-provider
pattern scanning and validity checks were not enabled; the repository's Gitleaks workflow
supplies a separate generic-pattern scan. No assertion of perfect detection is made.

Local independent QA additionally passed all 18 disposable Docker checks without changing
the live hub or its image tag. See [implementation](implementation.md) and
[security review](security-review.md) for scope, dependency remediation and limitations.

This is a public source launch. No GitHub binary release, GHCR image or official vendor
marketplace listing was published. [The distribution plan](../../DISTRIBUTION.md) describes
those next deliverables. The installed live hub/client versions were not upgraded by this
source-publication task.
