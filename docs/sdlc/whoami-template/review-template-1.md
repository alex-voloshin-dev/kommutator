---
type: review
target: whoami-template
iteration: 1
verdict: approve
findings: []
---

# Common whoami template review and QA

The internal review approves the documentation-only template change. All table
references match the existing `whoami` result in `packages/agentd/src/core.ts` and
the session/topic schemas in `packages/protocol/src/`. Both full identifiers are
mandatory; absent optional values, empty topics and failed calls have explicit
presentation rules. Diagnostic requests do not instruct agents to change status,
membership or identity. Credentials are excluded.

## QA evidence

- Re-read the canonical skill, the hosted Codex copy, the Codex etiquette pointer
  and the implementation handoff.
- Verified `scripts/export-plugins.mjs` copies the canonical Claude skill directory
  into both vendor exports, and `scripts/lib/hosted-plugin.mjs` copies it into the
  hosted Codex plugin.
- `cmp plugins/claude-code/skills/kommutator/SKILL.md plugins/hosted/codex/skills/kommutator/SKILL.md`: passed.
- `node scripts/verify-hosted-plugins.mjs`: passed.
- `git diff --check`: passed.
- No tests were added solely for documentation. No workspace runtime suite was
  run for this template-only review and QA.

## Limits

The checks establish source consistency, not live vendor rendering or compliance
by a model. No release or installed-client update was tested here. The concurrent
Claude identity defect is outside this template-only review; this approval does
not cover that implementation. No external reviewer result is included in this
artifact.
