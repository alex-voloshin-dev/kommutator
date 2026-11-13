# ADR 001 — Versioned process birth with explicit legacy transition

## Context

Inherited-timezone `ps lstart` is not a stable owner identity and can consume more than the hook's full budget. Existing private paths, registry rows and operation ownership all embed that representation. Legacy values have no timezone provenance.

## Decision

Use a tagged Linux boot-ID/start-tick token and a tagged, fixed-UTC/locale portable ps fallback. Treat cross-format comparisons as unknown. Preserve legacy data, reject same-live-PID legacy adoption and require coordinated daemon/MCP/hook upgrade followed by a new OS process. Adopt a unique matching predecessor's history only after positive old-PID exit through existing resume ordering and fences. Plugin replay requires its committed journal; direct updated manual hooks remain valid without positive generation. Increment local schema and client compatibility contract, but do not claim IPC rejection prevents old hooks from writing legacy-path end markers before connecting.

## Alternatives considered

- Force UTC in the existing helper only: small patch, but changes hashes and falsely retires owners whose stored values were local time; rejected as an upgrade strategy.
- Accept equivalent timezone offsets or compare PID only: convenient recovery, but cannot distinguish PID reuse or prove a historical formatter; rejected.
- Invalidate every legacy record and demand fresh identities: simple, but needlessly strands histories/outboxes and disrupts all active users; rejected.
- Adopt a legacy owner in the same PID after a new SessionStart: avoids restarting, but old loaded lifecycle hooks may write retirement into a different namespace before IPC rejection. Reject hot migration rather than invent a retirement bridge without evidence.
- Native platform APIs everywhere: potentially stronger birth precision, but adds unqualified platform code and dependencies to an urgent Linux fix. Retain a candidly weaker portable fallback and separate platform evidence gate.

## Consequences

Identity is stable across timezone on Linux without a subprocess. Legacy uncertainty remains explicit; coordinated fresh-process activation is required per reconnecting owner, and mixed lifecycle hooks within that owner/hot downgrade are unsupported. Service activation may leave unrelated old clients alive but disconnected, provided old bindings reject, same-live-PID adoption rejects and native delivery requires verified birth. No host-wide process shutdown is required. Existing outbox keys and receipt history are retained when positive old-owner exit permits adoption. No assertion is made that a fresh start or PID equality proves old birth equality.

## Integration clarification

The original reviewed wording could be read as requiring every old process to exit before daemon activation. Integration review identified that the updater does not implement such a global gate. The clarified safety boundary is per owner: unrelated legacy processes cannot bind or receive native delivery and their old journal markers cannot end another PID/birth's new authority. This clarification does not assert that the original global gate existed, relax identity fences, or establish client availability from service health. The concrete transition procedure is in `docs/LOCAL_RELEASE_DEPLOY.md`; integration review must verify the clarified deployment contract.
