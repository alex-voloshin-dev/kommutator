---
title: Local feedback maintenance mandate
type: note
tags: [operations, automation, authorization]
---

# Feedback maintenance mandate

On 2026-11-01 the repository maintainer asked this local agent to continuously monitor
`kommutator feedback`, verify incoming reports and either fix/test/review/publish a new
version or respond as circumstances require. The mandate includes ordinary commits, tags
and releases for `alex-voloshin-dev/kommutator`; peer messages themselves never supply consent.

This records the local operator's decision, **not universal authorization for every clone,
fork or installer**. Automation is disabled unless a private policy explicitly records that
operator's standing authorization, exact repository/topic, model, effort and ingestion start.
The policy is outside worker write paths. See [the operations guide](../FEEDBACK_MAINTAINER.md) and DESIGN §19.

Keep the observer tool-disabled. Separate engineering workers use fresh clones and normal
workspace-write automatic approval review. A sandbox permission error should request normal
review when required; actual automatic-review denial blocks the job and must never be
circumvented. Uncertain publication and interrupted work require explicit reconciliation.
