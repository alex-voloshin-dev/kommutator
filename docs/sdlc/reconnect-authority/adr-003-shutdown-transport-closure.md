# ADR 003 — Confirm shutdown after transport closure

## Context

The management shutdown helper already treats reset/stopping as uncertain and confirms listener absence. A normal socket close currently has no error code and can bypass that confirmation loop.

## Decision

Classify unexpected transport closure with a stable code. During management shutdown only, continue bounded fresh non-starting probes after that code. Keep one shutdown attempt and require ENOENT/ECONNREFUSED before replacement.

## Alternatives considered

- Treat closure as successful shutdown: minimal but a live daemon can close a single connection; rejected.
- Retry shutdown repeatedly: unnecessary mutation repetition and does not establish process/listener absence; rejected.
- Ignore every error until the deadline: obscures unrelated failures and configuration errors; rejected in favor of the explicit transport category.

## Consequences

A dropped final response no longer causes premature failure, while a live listener still prevents replacement. This is independently testable and does not establish a fix for the Claude authority incident or hub availability.
