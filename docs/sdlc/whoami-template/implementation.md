# Common whoami response template

## Scope and assumptions

The user requested one consistent user-facing `whoami` report across client plugins.
This is a presentation instruction change, not a wire/API or identity-binding change.
The Claude skill directory is the canonical source already copied into both vendor
exports by `scripts/export-plugins.mjs` and into hosted Codex assets by
`scripts/lib/hosted-plugin.mjs`. The tracked hosted copy is synchronized; existing
release archives and checksum pins are unchanged.

## Changes

- Added a fixed-order Markdown table with full hub and vendor session IDs, handle,
  vendor, host, role, project, directory, topics, state, wake, capability, incarnation
  and status. Values map to the existing `{ session, topics }` result.
- Required fresh tool data, explicit missing-value handling, localized labels and
  unchanged identifiers; excluded credentials and diagnostic state mutations.
- Distinguished registration incarnation from vendor restart counts and wake policy
  from delivery capability. Identity comparisons must not infer a root cause from
  matching IDs alone.
- Linked the Codex etiquette snippet to the common skill template.

## Verification

- `node scripts/verify-hosted-plugins.mjs`: passed.
- `cmp plugins/claude-code/skills/kommutator/SKILL.md plugins/hosted/codex/skills/kommutator/SKILL.md`: passed.
- `git diff --check`: passed.
- Compared every table mapping with `packages/agentd/src/core.ts` (`whoami`),
  `packages/protocol/src/schemas.ts` and `packages/protocol/src/results.ts`.
- No tests added or workspace build/test run for this documentation-only change.
  No new release, installed-client update or live vendor rendering is claimed.

## Remaining work

The concurrent Claude identity correction is documented in
[its implementation checkpoint](../claude-session-identity/implementation.md).
The template makes the IDs visible; ownership is enforced by that runtime change.
Existing installations receive both changes through the 0.2.2 client update.
