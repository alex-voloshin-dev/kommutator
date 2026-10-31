---
type: research-brief
feature: plugin-distribution
status: final
date: "2026-10-28"
sources:
  - "https://agent-plugins.org/plugin-authors/build-an-agent-plugin"
  - "https://agent-plugins.org/plugin-authors/mcp-servers"
  - "https://developers.openai.com/plugins/build/plugins"
  - "https://developers.openai.com/plugins/deploy/submission"
  - "https://developers.openai.com/plugins/deploy/desktop-only"
  - "https://learn.chatgpt.com/docs/plugins"
  - "https://learn.chatgpt.com/docs/hooks"
  - "https://code.claude.com/docs/en/plugin-marketplaces"
  - "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference"
  - "https://docs.github.com/en/copilot/reference/hooks-reference"
  - "https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference"
  - "https://prod.cursor.com/docs/reference/plugins"
  - "https://geminicli.com/docs/extensions/reference/"
  - "docs/PROTOCOL.md"
  - "docs/sdlc/m2-lan/installed-validation.md"
---

# Cross-vendor plugin distribution

## Question and recommendation

How should kommutator become installable through marketplaces across Claude Code,
Codex, Copilot and additional agents without conflating installation with working
session messaging?

Recommend one versioned local runtime, a shared Agent Skills/MCP source, and small
client-specific packages generated from it. Start with a repository marketplace for
Claude Code and Codex, then qualify Copilot CLI and VS Code separately. Use Agent
Plugins 1.0 as the portable packaging floor where supported. Preserve native formats
when required for hooks or older tested clients. These are research recommendations,
not implemented changes or a new support guarantee.

One repository can contain multiple catalog formats; it need not host a marketplace
web service. A public vendor directory is a separate distribution channel with separate
admission rules. No publication, configuration change, Git initialization, or runtime
installation was performed in this research.

## Evidence and existing constraints

Three independent research tracks examined the repository, Claude/Copilot, and
Codex/Work. Primary documentation was checked on the date above. Documentation proves
a packaging contract; only live tests prove kommutator compatibility.

The current [Claude manifest](../../../plugins/claude-code/.claude-plugin/plugin.json)
launches `kom mcp`; its [README](../../../plugins/claude-code/README.md) requires an
installed runtime. [Codex assets](../../../plugins/codex/README.md) currently require
manual MCP/hook setup. Neither is a completed marketplace release. The
[CLI package](../../../packages/cli/package.json) is version 0.0.0 and depends on
workspace packages; the [build](../../../packages/cli/tsup.config.ts) is not evidence
of a self-contained distributable. Clean tarball installation remains a release gate.

Existing identity, receipt and delivery boundaries remain authoritative:
[protocol](../../PROTOCOL.md), [Codex identity note](../../knowledge/codex-root-identity.md),
[installed validation](../m2-lan/installed-validation.md). Hub stays in Docker with
persistent state and its existing LAN restriction. Client daemon/MCP/hooks run in the
client execution environment. Windows UI, WSL execution, native Windows execution and
cloud execution are distinct targets.

## What can be portable

[Agent Plugins](https://agent-plugins.org/plugin-authors/build-an-agent-plugin) defines
a root `plugin.json`, `skills/`, and `mcp.json`; installation and updates remain
client-owned. Its [MCP contract](https://agent-plugins.org/plugin-authors/mcp-servers)
allows local stdio or remote transports, but does not supply a universal chat identity.
Its default stdio cwd is the plugin directory, a critical difference from a project
launch. Package-relative assets must remain inside the installed package.

Share tool semantics and coordination etiquette: whoami, discovery, joining topics,
send/read/ack, boards, DND, queued-send handling, and the rule that a peer message does
not establish user consent. Adapt manifests, event payloads, trust and context injection
at the client boundary. Do not duplicate messaging or routing logic in each plugin.

| Client surface | Documented package path | kommutator evidence and remaining gate |
| --- | --- | --- |
| Claude Code | `.claude-plugin/plugin.json`; Git/local marketplace | Existing live identity and native delivery under recorded policy; clean marketplace installation remains untested. |
| Codex CLI | Agent Plugins or legacy `.codex-plugin`; repo marketplace | Existing local MCP metadata and trusted hooks passed; plugin-based migration/install needs tests. |
| Local Work desktop | OpenAI plugin system | Engine evidence only; actual desktop thread acceptance remains open. |
| Codex IDE extension | Plugin installation currently unsupported in the cited surface documentation | A separate MCP configuration path would need qualification; do not advertise plugin support. |
| Copilot CLI | Agent Plugins or Claude-compatible legacy format | No kommutator runtime acceptance; probe MCP-to-hook identity before claiming support. |
| Copilot in VS Code | Agent Plugins and other supported formats | Qualify separately from CLI, including selected chat harness and WSL/remote execution location. |
| Cursor | Agent Plugins or `.cursor-plugin/plugin.json` | Candidate; session isolation and delivery untested. |
| Gemini CLI | `gemini-extension.json` | Candidate native wrapper; identity and delivery untested. |

Sources for the packaging column: [Claude marketplace](https://code.claude.com/docs/en/plugin-marketplaces),
[OpenAI packaging](https://developers.openai.com/plugins/build/plugins),
[Work surfaces](https://learn.chatgpt.com/docs/plugins),
[Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference),
[VS Code](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference),
[Cursor](https://prod.cursor.com/docs/reference/plugins),
[Gemini](https://geminicli.com/docs/extensions/reference/).

Do not assume one multi-manifest folder behaves identically everywhere. Copilot prefers
the standard root manifest over the legacy one. Cursor documents that standard
`${PLUGIN_ROOT}`/`${PLUGIN_DATA}` expansion in MCP config is not implemented. Generated
client packages avoid accidental component shadowing; no cross-package symlinks.
Gemini uses its own extension configuration and settings/environment handling. Keep the
initial runtime prerequisite explicit rather than assuming bundled Node 24 exists.

## Compatibility gates that packaging cannot solve

1. **Root identity.** Current generic sessions use `shim:<pid>` in
   [daemon core](../../../packages/agentd/src/core.ts). A shared MCP process can merge
   unrelated chats. Existing Codex routing explicitly handles per-call metadata;
   unknown clients cannot inherit this guarantee. Require observed per-call/root
   identity or a proven one-process-per-root lifecycle before enabling session tools.
   Otherwise report unsupported identity, rather than guessing by cwd, model-supplied
   handle or process parent. A common explicit client profile is a proposed runtime
   change; it is not an existing `kom mcp` option.
2. **Inherited identity.** [shimHello](../../../packages/cli/src/ipc-client.ts) can use
   Claude environment identity for a non-Codex client. Test nested launches and make
   client selection explicit before broad distribution. Trusted local transport
   metadata identifies a session; it is not cryptographic vendor attestation.
3. **Project association.** The shim currently sends `process.cwd()`. Plugin cache cwd
   must not become the user's project topic. Probe workspace information from host
   metadata/hooks or MCP roots, reconcile multiple roots, and define ambiguous/no-root
   behavior before implementation. Never silently assign every client to the plugin repo.
4. **Hooks and wake.** Copilot documents `sessionId`/`session_id` hook payloads and
   Stop continuation, but that does not establish MCP correlation or external idle
   wake: [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference).
   Keep existing delivery levels: `none` = explicit MCP inbox polling, `hook` =
   delivery at a supported hook opportunity, `native` = verified idle turn initiation.
   Unknown identity is unsupported, not a degraded polling capability.
5. **Execution platform.** Node 24, Unix IPC, actual GUI PATH and host-local daemon
   visibility must be verified. Native Windows clients remain unsupported by the
   current implementation; installing a manifest there does not add named pipes.

## Proposed installation experience

**Superseded implementation choice, 2026-10-28:** the user selected plugin-only
onboarding with bundled Node and application dependencies, automatic immutable runtime
bootstrap outside plugin caches and a private local browser setup form. The manual-runtime
recommendation below is retained as research history, not the current install procedure.
See [local artifact build](BUILD.md).

The user installs the shared runtime once in each supported local execution environment,
adds the marketplace in their client, and installs the matching kommutator plugin.
First-use setup asks for the hub address (default TCP 8787), host name and secret through
a private input path. The same OS user can reuse the existing private daemon config
across Claude and Codex. Do not ask users to paste the hub key into model conversations.

The plugin supplies discoverable setup/coordination instructions and vendor hooks.
Setup checks runtime location/version, configuration, authenticated connectivity,
identity, project mapping and observed delivery capability. After client trust and a
fresh session, the user sees a concrete address and can ask to join a topic or send a
message. Topic memberships remain session-scoped; saved subscription preferences would
be a separate behavior change.

Store the shared runtime outside disposable plugin caches. Keep keys and daemon state
outside packages. Maintain an explicit runtime compatibility range and reject unsupported
versions before attaching; this requires new checks because current protocol mismatch
handling only logs a warning. Upgrade wrappers independently without silently replacing
a running shared daemon. Uninstall removes only owned integration entries, retaining
shared runtime/config until explicitly removed. Migrate existing manual MCP/hooks with
backup and duplicate detection; never run plugin and global copies simultaneously or
bypass hash trust after hook changes. [Current setup](../../../plugins/codex/README.md),
[protocol version behavior](../../PROTOCOL.md).

## Marketplace and public-directory strategy

Generate client catalogs and packages from one release definition: Claude's
`.claude-plugin/marketplace.json` and OpenAI's `.agents/plugins/marketplace.json`, plus
the chosen compatible Copilot catalog. Keep identity/version/repository metadata in
sync. Prefer separate package entries per harness until multi-manifest loading is
tested. Use local catalog tests first, then a versioned Git distribution.

OpenAI currently rejects public submissions containing lifecycle hooks:
[submission rules](https://developers.openai.com/plugins/deploy/submission). Public
local-MCP submissions require approved-partner allowlisting:
[desktop-only submissions](https://developers.openai.com/plugins/deploy/desktop-only).
Thus repository/private distribution is the practical first channel. Cloud-orchestrated
Work does not support these local/plugin hooks; the local-only boundary is explicit in
the [hooks documentation](https://learn.chatgpt.com/docs/hooks).

A public remote-MCP edition is later architecture work: the current hub HTTP/WS API is
not a remote MCP endpoint, and its shared-key LAN deployment is not a public hosted
multi-tenant service. Do not publish the LAN address as a marketplace MCP URL or broaden
firewall access to make cloud clients work. A later remote edition needs its own session
identity, authentication, authorization, transport and hosting design.

## Alternatives and recommended next work

* One Claude-format package everywhere: reduces packaging initially but leaves loader
  precedence, hook semantics and client identity unresolved.
* MCP-only everywhere: useful only once identity is verified; it loses native/hook
  delivery and cannot promise independent chat mailboxes on a shared server process.
* Separate full implementations: unnecessary duplication of existing shared routing,
  receipts and persistence; use thin integration packages instead.

Recommend the next product/technical specification cover a bounded first release:
Claude Code and Codex local packages, one shared runtime installation contract, and
Copilot CLI/VS Code discovery spikes. Acceptance must include clean installation from
an exported package without the development checkout; two same-folder roots; correct
project topics from a plugin-cache launch; cross-vendor DM/reply; outbox/restart
recovery; uninstall/update without harming other clients; duplicate-hook migration;
and actual runtime versions recorded per OS/client surface. Run vendor validators and
secret/path scans on exported artifacts. Add no native-wake badge without a live idle test.

Before public publication, resolve the license (still open in MVP_PLAN), package names,
publisher accounts and distribution policy. These do not prevent local packaging work.
Keep the existing day-long, reboot, external-LAN and desktop acceptance gaps separate.

## Workflow delivery

Draft prepared in an isolated temporary documentation directory because this checkout
has no Git repository; retain the existing source-transfer workflow rather than creating
a release repository during research. The independent skeptic review approved the brief with no material findings. The
configured external-review helper was attempted and exited 1 with no parseable review;
that optional lens supplied no verdict. Header validation and artifact read-back passed;
the bounded review loop returned proceed. Only documentation is delivered; no tests of
plugin installations are claimed. See [review record](review-research-brief-1.md).

Historical licensing note: earlier statements about an unchosen license describe their
dated checkpoint. MIT was selected for public preparation on 2026-10-29; see the root LICENSE.
