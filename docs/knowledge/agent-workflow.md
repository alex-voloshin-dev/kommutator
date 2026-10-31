---
title: Shared Codex and Claude workflow
type: note
tags: [agents, workflow]
---

# Shared Codex and Claude workflow

[AGENTS.md](../../AGENTS.md) is the shared project instruction file;
[CLAUDE.md](../../CLAUDE.md) imports it. Start tools from the project root, especially
before Git exists. The files under plugins/ are shipped product integrations, not the
development environment. Install product MCP/hooks only for an intended product integration or test.

The [current map](../ARCHITECTURE.md) and [roadmap](../ROADMAP.md) are contributor entry points.
The [MVP plan](../MVP_PLAN.md) preserves historical build order and acceptance criteria;
DESIGN and protocol sources supply contracts. New decisions belong in DESIGN §19 and
vendor observations in spikes/RESULTS.md. Notes and handoffs link to that evidence.
English is the artifact/code language; conversation follows the user's language.

The historical Git gate was live M1 E2E, subsequently passed. MIT was selected for public
preparation on 2026-10-29. Source publication remains a separate action, and local runtime
configuration must never be swept into a source commit.

Optional maintainer automation can validate note links and handoff headers, but no private
plugin installation is required to contribute. Do not infer that checks ran from installed
tooling; record actual results. The original [onboarding](../sdlc/repo-onboarding/onboarding.md)
is a dated scaffold snapshot, not a current implementation map.
