# Building standalone client plugins

This step is for the operator producing client artifacts. End users install from the
GitHub marketplace using the [quickstart](QUICKSTART.md); they do not need the build toolchain.
The hub-only Docker path also does not need host Node or pnpm.

From the project root, with Node 24.11 or newer in the Node 24 line and pnpm 10.18.0
(and Python 3 plus GNU tar for packaging the hosted release):

```sh
pnpm install --frozen-lockfile
pnpm release:check
node scripts/export-plugins.mjs /tmp/kommutator-local-linux-x64
```

The commands above rebuild the current version whose hosted catalogs are already generated.
For a new version, follow the [release procedure](DISTRIBUTION.md#maintainer-release-procedure):
bump/sync, build/typecheck/test, export/package, then run `pnpm release:check` after the new
catalogs exist. Otherwise the version consistency check correctly rejects stale catalogs.

Output must be a fresh directory. The exporter bundles the CLI and production workspace/npm dependencies using the installed
esbuild version, then packages Node, redistribution licenses, hub assets, client manifests/hooks/skills,
two local marketplace catalogs and `SHA256SUMS`. It does not publish or mutate client config.
The release gate includes synthetic E2E (`node scripts/test-plugin-export-e2e.mjs /absolute/path/to/artifact`).
For a focused rerun, run `node scripts/smoke-plugin-export.mjs /absolute/path/to/artifact` for isolated
no-system-Node MCP/setup/cache-lifecycle checks. Check integrity from the output directory with `sha256sum -c SHA256SUMS`. The project is MIT licensed; retain the project LICENSE, Node license and dependency notices.
Public distribution remains an explicit release action; see [release procedure](DISTRIBUTION.md).

By default the current Node executable is used; its adjacent `../LICENSE` is preferred,
with `/usr/share/doc/nodejs/LICENSE` as the distribution fallback. To build
another supported target, supply an official extracted Node 24 distribution's binary/license:
`KOM_EXPORT_NODE`, `KOM_EXPORT_NODE_LICENSE`, `KOM_EXPORT_PLATFORM` (`linux` or `darwin`) and
`KOM_EXPORT_ARCH` (`x64` or `arm64`). Cross-target exports require execution on that target
before claiming support. These standalone local artifacts contain Node already; they do not download it at startup.

For end-user setup, use the canonical [installation guide](INSTALL.md).
The source repository Git URL now provides hosted plugin catalogs. Its automatic source
archive still does not contain a bundled runtime. Claude downloads its pinned release ZIP
during plugin installation; the Codex launcher downloads its pinned release at first startup. To prepare that release after exporting, run:

```sh
node scripts/package-client-release.mjs /tmp/kommutator-local-linux-x64 /tmp/kommutator-release
```

Both paths must refer to the verified export and a fresh release output directory. This
generates the versioned archives/checksums and the tracked hosted catalogs/launcher.

For local process testing use an isolated `HOME`, `CODEX_HOME` and `KOM_HOME`. Plugin hook
entrypoint: `plugins/<vendor>/bin/hook SessionStart` with real-shaped stdin JSON. MCP:
`plugins/<vendor>/bin/mcp`. POSIX shell utilities and bundled Node suffice; no system `node`
or `kom` is needed. Native Windows, cloud threads, desktop native wake and untested macOS
artifacts are not certified by Linux process checks.

A running older daemon is not restarted automatically. `setup_status` reports compatibility;
after ending active sessions, explicitly run `/installed/plugin/path/bin/manage daemon restart`
to switch to the bundled runtime. The normal OS `ps` utility remains necessary for process-birth
checks (Node and `kom` need not exist on PATH). Hook process deadlines remain bounded; if a hard
kill interrupts private registration snapshot locking, start a fresh vendor session rather than
reusing an interrupted root. Codex clients may filter custom `KOM_HOME` from MCP environments;
use default shared locations for normal installation, or configure matching MCP/hook environment
explicitly when testing overrides.

The root package.json version is the authoritative release version (currently 0.2.0,
a development preview). After a deliberate version bump run `pnpm version:sync`; builds
and the release gate check derived version consistency. Runtime content hashes and runtime
compatibility-contract versions are separate identifiers. This does not publish a release.
