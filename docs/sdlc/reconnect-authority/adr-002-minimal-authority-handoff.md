# ADR 002 — Minimal durable SessionStart authority before delivery

## Context

An immutable linked generation is recoverable authority; launch environment, diagnostic observations and empty journals are not. The current pre-publication ps subprocess can exceed the unchanged 140 ms hook timer. Disk or scheduler stalls can also prevent any durable capture.

## Decision

Publish the complete versioned hook event using the existing private immutable journal before delivery imports, daemon probes and compatibility aliases. On Linux, use fast synchronous proc reads and a minimal synchronous publication section after bounded input validation, removing asynchronous scheduling gaps before commit. Bound journal counts, inspected bytes and collision retries. Use the same event/epoch/generation for MCP replay and exact SessionEnd tombstones. Preserve all fallback fences and deadline constants. State explicitly that termination before any durable event cannot be repaired from MCP hints and blocked synchronous I/O delays timer execution.

## Alternatives considered

- Increase hook/IPC deadlines: gives more time but violates the required fail-open budget and does not establish durable authority; rejected.
- Register from MCP environment or prompt hooks when the journal is absent: responsive but can adopt stale conversations or inherited IDs; rejected.
- Replay temporary or partially written files: may recover a few interrupted writes but lacks committed ordering and end semantics; rejected.
- Add a second launcher intake journal: can move the boundary earlier but creates another ordering, migration and retirement protocol. Defer unless a reproduced pre-publication failure remains after fast birth capture and the stronger requirement warrants independent design.
- Keep asynchronous publication after only replacing ps: simpler, but retains the separately reproduced async-link delay window; rejected for this scoped repair.

## Consequences

Post-publication interruptions remain recoverable without hook retries. The reproduced asynchronous delay mechanisms are removed, while arbitrary pre-publication storage stalls remain explicitly unsupported; a blocked synchronous call can exceed the timer. Tests must demonstrate committed authority and measured process latency. Faster happy-path capture is not proof of universal restart recovery.
