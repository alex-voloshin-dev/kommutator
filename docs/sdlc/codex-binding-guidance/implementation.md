# Codex binding guidance implementation

The direct request is the plan: correct Codex missing/ended registration guidance while
preserving binding and error code `-32020`. No registration, retry, timing, schema or
version change is required. Review and QA are separate follow-up gates.

`packages/agentd/src/binding.ts` now directs a missing or ended Codex root to reconnect
Kommutator MCP for the current root and call `whoami`. Multiple live exact Codex matches
report ambiguity without registration advice. Non-Codex guidance is unchanged.

`packages/agentd/test/daemon-core.test.ts` adds three cases covering missing, ended and
ambiguous exact Codex records. They verify rejection, unchanged registry and hub calls,
and absence of a bound identity; missing/ended cases include another same-cwd root and
a same-ID Claude owner to protect the vendor and exact-root boundaries. Existing tests
continue to cover successful root binding, hook liveness, owner fencing and authorization.

Validation in the isolated implementation worktree used Node 26.13.0 and pnpm 12.18.0:

- `pnpm install --frozen-lockfile`: passed with its own dependency directory.
- `pnpm -r build`: passed.
- `pnpm -r typecheck`: passed.
- `pnpm --filter @kommutator/agentd exec vitest run test/daemon-core.test.ts`: 127 passed.
- `git diff --check`: passed.

The full ordered workspace gate and independent review/QA remain for the integrated
checkout. No live MCP, deployment, release or packaging check was performed. Existing
day-long, subnet, reboot and native-wake acceptance gates remain open.
