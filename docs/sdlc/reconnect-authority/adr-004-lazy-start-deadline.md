# ADR 004 — One absolute lazy-start connection deadline

## Context

The baseline's fixed startup retries can reject a first MCP call after approximately 1.75 seconds even when its declared budget is five seconds. An isolated listener appearing after 2.2 seconds reproduces failure on the first call and success on the second.

## Decision

Use one monotonic absolute deadline across connection attempts, readiness waits and hello. Spend only the remaining caller timeout, spawn once, and stop on cancellation or client close. Connection establishment may retry; an application RPC already dispatched may not. Keep non-starting management probes and short hook budgets intact.

## Alternatives considered

- Increase retry count globally: simple but divorces the wait from per-call budgets and can slow short hooks; rejected.
- Ask the model to retry the tool: hides a deterministic startup defect and risks repeating uncertain mutations; rejected.
- Restart the timeout for every attempt: increases apparent success but violates a bounded caller budget; rejected.

## Consequences

A first call can succeed when readiness occurs within its advertised budget. Deadline and cancellation tests must cover all connection phases; this does not authorize automatic replay or registration from missing authority.
