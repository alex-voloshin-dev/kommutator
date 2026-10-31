---
title: Vendor experiments gate native delivery
type: note
tags: [adapters, spikes, risks]
---

# Vendor experiments gate native delivery

The [live report](../../spikes/RESULTS.md) and [sanitized JSON](../../spikes/evidence/2026-10-25-claude-2.1.310.json)
record Claude Code 2.1.310 on macOS, 2026-10-25. Manual idle wake worked with and without
a token using `{"type":"user","message":{"role":"user","content":"…"}}`. Bypass/default
was Held even with a valid token. All four socket replies were empty, so close/exit 0
cannot distinguish Delivered from Held and cannot mark read.

Two simultaneous same-cwd MCP processes exposed `CLAUDE_CODE_SESSION_ID`, each matching
its own hook payload. Production `whoami` now has same-cwd process coverage. SessionStart omitted
permission_mode; Stop supplied it. Missing mode means unknown, not default. See
[[protocol-and-boundaries]] for the host-local binding boundary.

Claude Stop continued exactly once and respected re-entry. A detached Bash-tool descendant
survived Claude exit. Steps 3–4 process QA confirms a detached daemon survives the first
of two real MCP shim processes exiting, using fake vendor sessions. A subsequent production MCP launch from actual Claude also survived Claude exit;
full two-session production M1 E2E subsequently passed on the same Mac.
Codex and Ubuntu were not tested. The hook parent was Claude in all six observed sessions.

[claude.ts](../../packages/agentd/src/adapters/claude.ts) now emits the observed envelope
and preserves sender/message/thread IDs plus peer etiquette. The authorized follow-up passed with
both immediate half-close / five-second timeout and an eight-second delay, using the observed envelope from an external process. This
verifies external-sender timing; production-path live evidence is separate. [Adapter tests](../../packages/agentd/test/claude-adapter.test.ts)
use a fake socket; the negative response shapes are defensive, not observed vendor ACKs.
No code should promote silent writes to accepted or assume a token enables bypass delivery.

[DESIGN v0.2.9](../DESIGN.md) and [MVP_PLAN rev 6](../MVP_PLAN.md) reconcile this evidence.
The user-authorized [bypass follow-up](../../spikes/01-claude-inbox-socket/BYPASS_FOLLOWUP.md)
passed with explicit per-session `crossSessionInbound: accept`; default stayed Held.
[Follow-up evidence](../../spikes/evidence/2026-10-25-claude-2.1.310-bypass-optin.json)
records external sender ancestry, 45-second sender lifetime, idle pongs and zero socket
reply bytes. The setting accepts peer messages generally, not only kommutator. It was
applied only to the disposable launch, with no global or repository policy modification.
The user accepted this per-session opt-in for bypass M1 on 2026-10-25. Launch with
`KOM_CLAUDE_INBOUND_POLICY=accept` alongside the actual Claude settings override. The marker
is a declaration, not a settings mutation or independent policy verification. Default-policy
bypass remains hook-only; [[agent-workflow]] keeps Git gated on live E2E.

The [production partial run](../../spikes/evidence/2026-10-25-m1-production-partial.json)
also verifies one live author identity and board read/write. The second Claude session
was stopped at folder trust: automatic approval review required explicit consent for
persistent project trust. That run restored the first session's trust flag and removed
its test processes and private files. The user then authorized temporary trust and restoration.

The [full production run](../../spikes/evidence/2026-10-25-m1-production.json) passed:
both same-cwd identities matched their vendor UUIDs, idle author received a native peer
message and replied in the original thread, both read decisions v1, and handoff v1 appeared.
The dashboard captured registration/send/delivery/read. The same daemon served reviewer
53.198 seconds after author exit. Temporary trust returned from absent to true to absent;
all test processes and credentials were removed. Receipts came from shown hook headers
before explicit reads; the vendor-injected message and autonomous turn prove native wake.
Step 7 operability, cross-vendor and second-host acceptance remain separate work.

Follow-up, 2026-10-27: [[codex-root-identity]] records the M2 root metadata and hook
boundary; earlier Codex-deferred statements above describe the historical M1 baseline.
