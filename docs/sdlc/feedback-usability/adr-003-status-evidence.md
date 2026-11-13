# ADR 003: Keep aggregate degradation and expose independent health evidence

## Context

A blocked historical outbox row keeps aggregate health degraded after connectivity recovers.
Clearing that state would conceal unresolved work; an age threshold cannot prove safe disposal.
Caller wrappers can independently discover ownership failures after daemon status returns.

## Decision

Preserve legacy aggregate health and add independent connectivity, caller, backlog and historical
error evidence in a bounded MCP projection built after caller wrappers. Show ages, a persistent
outstanding warning and at most five blocked examples with an omitted count. No stale-age cutoff,
new queue mutation or automatic retry. Existing status-triggered background retirement
reconciliation and flushing are preserved; only the added projection is pure. Missing evidence
stays unknown/unverified.

## Alternatives considered

- Make overall status healthy once connected: simple but hides unresolved failures and caller risks.
- Ignore blocked entries older than a threshold: improves appearance without evidence that work
  resolved, and introduces arbitrary wall-clock severity changes.
- Expose every blocked entry by default: comprehensive but unbounded and duplicates detailed status.
- Replace legacy health with a new structure: clean but breaks existing scripts and older wrappers.

## Consequences

Legacy aggregate health may remain degraded while connectivity is connected and caller active;
these are intentionally different facts. Consumers gain a clear explanation without losing warning
signals. This presentation work does not resolve backlog, prove native delivery or fix availability.
