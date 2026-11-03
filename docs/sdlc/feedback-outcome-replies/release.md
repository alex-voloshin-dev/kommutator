---
type: release
feature: feedback-outcome-replies
status: approved
version: 0.7.1
changelog:
- section: Fixed
  entries:
  - Keep maintainer queued and running progress on the board; send only terminal outcomes to the topic.
breaking: []
---
# kommutator 0.7.1 development preview

## Fixed

Maintainer queued/running progress now stays on durable board entries. Only answered,
released and blocked outcomes send source-thread topic replies, reducing lifecycle messages
that consume hook header slots. Pending progress reports from older versions also complete
without a new topic reply. Existing messages remain in history; replay keys are preserved.

The change is in the optional observer tooling. An operator must update/restart that service
to apply it. This release task changes no live services or client profiles. Hub schemas,
protocol contracts and hook receipt behavior are unchanged.

## Validation

Node 24.22.1 / pnpm 10.18.0: build, typecheck and 403 workspace tests passed.
`pnpm release:check` passed, including all 96 script tests, dependency audit (no known
vulnerabilities), hosted pins, fresh export integrity/licenses, startup/setup and synthetic E2E.
Focused QA passed 51 observer/maintainer/migration tests, followed by 13 maintainer tests
after the procfs test repair. Independent code/security reviews approved the change.
The optional external CLI reviewer returned no parseable result and was skipped.
Full-history and diff secret scans found no leaks. Artifact scanner matches were verified
public license checksums. The exact candidate bundles passed integrity/checksum checks,
clean-PATH startup/private setup and synthetic cross-vendor/recovery E2E.

Early sandbox runs failed due to subprocess restrictions; approved process/socket runs
passed. An initial release-gate run caught an existing ESRCH procfs test race; the test now
recognizes process disappearance without weakening its termination assertion.

## Not validated

Live observer deployment and real vendor installation of this version were not exercised.
Day-long use, reboot/logon, physical allowed/denied subnet clients, Work desktop/native idle
wake and non-Linux-x64 bundle execution remain open. Synthetic tests do not close these gates.
