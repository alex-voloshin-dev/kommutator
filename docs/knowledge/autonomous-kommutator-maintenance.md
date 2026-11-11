---
title: "Autonomous Kommutator maintenance"
type: note
tags: ["maintenance", "decision", "release"]
---

# Autonomous Kommutator maintenance

The maintainer explicitly authorized autonomous action on 2026-11-11: investigate feedback, decide whether a fix is warranted or a proposal improves Kommutator, implement it, validate and review it, then publish a new version without waiting for a separate instruction. Evidence still governs the decision: do not claim an unconfirmed reported cause is fixed. After each release, update the local hub and daemon, verify health and announce the release and deployment outcome to the user and the canonical kommutator-feedback topic. Use the documented release and local deployment procedures in docs/PLUGIN_BUILD.md and docs/LOCAL_RELEASE_DEPLOY.md; keep credentials and runtime state outside source. This authorizes ordinary maintenance and release work; destructive data changes or unrelated access changes remain separately scoped. Related: [[agent-workflow]], [[operability-evidence]], [[protocol-and-boundaries]].
