# Research track evidence

Baseline db2493f / deployed behavior 0.9.1; read-only research on 2026-11-04.

- liveness_evidence inspected core.ts probeLiveness/registerOwner, registry.ts
  processExists and private daemon/Codex metadata. The parent independently re-read the
  exact daemon records now recorded in spikes/RESULTS.md, remaining reliability investigation.
  No exact-root shim shutdown correlation was established. Missing-birth registration is
  initially a source-derived hypothesis, subsequently reproduced by the parent in an
  isolated in-memory probe of the deployed bundle; a permanent regression is pending.
- reconnect_diagnostics traced hub-link.ts OfflineError through ipc.ts catch and mcp.ts
  display. DaemonStatusParams, statusForCaller and MCP diagnostics selection currently
  support caller health only for Claude. hooks.ts/index.ts have no persisted failed outcome.
- topic_watch_research traced CLI binding, inbox headers/receipt mutation and local delivery
  ledger limitations. Recommended explicit local-session management watch with hub-side
  topic filtering. The parent retrieved official tools-reference.md and plugins-reference.md
  from code.claude.com and observed local Claude version; vendor execution is not inferred.

The research brief contains the recommendations; source functions and sanitized observations
are the evidence, not the names or conclusions of the research agents themselves.
