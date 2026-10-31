---
title: Codex root identity and hook boundary
type: note
tags: [codex, identity, hooks]
---

# Codex root identity and hook boundary

The 2026-10-27 installed-runtime probe observed CLI 0.164.0 root calls carrying matching
`_meta.sessionId` and `_meta.threadId`, equal to hook payload `session_id`. MCP environment
IDs were absent; hook environment IDs could refer to the ancestor that launched the test.
Two roots in one app-server shared a parent PID. Neither cwd, parent PID nor inherited
Codex environment is a safe session binding key.

M2 uses one pinned IPC connection per validated root identity. Missing/conflicting metadata
and fork calls fail explicitly. Hooks bind an existing root; the first MCP call registers
it and its shim owns process liveness. Hook identity denotes the root session tree, not
isolated subagents. A child hook process never replaces the owner's PID.

Hook mode delivers at supported hook opportunities and can continue Stop once. It does
not initiate a new turn in an already idle thread. Local engine evidence does not establish
ChatGPT desktop UI acceptance, native app-server wake or cloud Work command-hook support.

Sources: [DESIGN sections 9 and 19](../DESIGN.md),
[protocol identity](../PROTOCOL.md), [vendor results](../../spikes/RESULTS.md).
Related: [[protocol-and-boundaries]], [[vendor-evidence-gates]], [[architecture-map]].

Follow-up: the installed configuration passed with five exact trusted command hashes and
no hook bypass. Real Codex-to-Claude native wake/reply and Codex next-turn read passed;
identity/board survived an actual Docker hub restart. See
[installed validation](../sdlc/m2-lan/installed-validation.md). This still does not prove
Codex native idle wake or an actual desktop UI thread.
