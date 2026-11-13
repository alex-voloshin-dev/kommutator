# ADR 002: Preserve full strict schemas through MCP registration

## Context

The shim currently passes object shapes to SDK 1.32.2. SDK prevalidation rebuilds a stripping
object before callbacks, so callback strict parsing cannot recover unknown keys. Users need
correct field names and full-ID guidance, not silent success or ambiguous prefix resolution.

## Decision

Register full strict objects and attach actionable bounded schema-level and field-level errors
that survive prevalidation. Keep real input schema fields, reject unknown keys before resolving
clients, and test with actual SDK calls. Never accept status/topic aliases or expand ID prefixes. Preserve the opaque 1–64-character
message-ID grammar and exact authorized hub lookup; production UUID format is not a new
validation constraint. Preserve empty set_status as a valid no-op.

## Alternatives considered

- Keep callback strictness only: already present and ineffective after SDK stripping.
- Accept common aliases: convenient but creates undocumented dual contracts and ambiguous mixed
  argument behavior. Clear rejection teaches the canonical schema without hidden coercion.
- Register permissive passthrough schemas and validate in callbacks: preserves keys but weakens
  advertised additional-properties constraints and leaves SDK field errors on a separate path.
- Replace SDK dispatch: could unify all errors, but disproportionate complexity and lifecycle risk.

## Consequences

Schema errors must carry useful guidance because callbacks may never run. Actual SDK transport
regressions guard against dependency behavior changes. Validation precedes operation IDs and IPC;
post-dispatch uncertainty still uses the existing reconciliation contract.
