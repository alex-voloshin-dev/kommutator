# Contributing

Start with [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md) and
[AGENTS.md](AGENTS.md). No private maintainer plugin or external account is needed.

Use Node 24.11 or newer in the Node 24 line (`.nvmrc`) and pnpm 10.34.9 (`packageManager` in package.json).
From the checkout root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm release:check
```

Build precedes checks because workspace imports and CLI process tests resolve built files.
The release gate additionally validates fresh Linux x64 artifacts, licenses, checksums,
clean-PATH smoke and synthetic integration. Other targets need execution on their target OS.
No lint or formatting script is currently configured. Keep the lockfile synchronized with
intentional dependency changes; do not substitute another package manager.

Type checking uses TypeScript 7 (`pnpm exec tsc --version`). Declaration bundling with
`tsup` still requires the JavaScript compiler API: `typescript` is an npm alias for
`@typescript/typescript6`, while `@typescript/native` aliases TypeScript 7 and supplies
`tsc`. Keep both aliases when updating the toolchain; removing the compatibility
package breaks declaration builds. This follows the
[TypeScript 7 migration guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

Make focused changes with behavior tests for changed contracts. Keep documentation in
English; update DESIGN/PROTOCOL/executable schemas together when behavior changes. Do not
commit generated plugins, dependencies, databases, keys, logs or local config. Test secrets
must be visibly synthetic. Evidence should retain versions, outcomes and limits while
redacting personal paths, machine addresses and raw conversations.

The 2026-10-29 review baseline was 324 passing workspace tests; it is a dated observation,
not a fixed expected test count. A green synthetic run does not prove native vendor wake,
external subnet filtering, reboot survival or day-long reliability.

Submit a focused change with its problem, resulting behavior, checks actually run and
remaining limitations. Publication and service changes are separate from code review.
Contributions are covered by the project's [MIT license](LICENSE).
