# Compact MCP responses

The fleet report described repeated large diagnostic and board acknowledgements. This change
keeps authorization, wire schemas, stored messages and read receipts unchanged while adding
presentation controls at the MCP boundary.

- Status defaults to session counts and an outbox summary. `detailed: true` restores full
  arrays; caller recovery, health, versions, hook observations and last errors remain visible.
- Board writes omit the echoed body unless `include_body: true`; version and replay evidence
  remain present.
- Session lists accept `compact: true`, retaining both identity IDs, handle, vendor, host,
  role, state and status line. Existing filters remain server-side.
- Inbox accepts `preview: false`; cursor, full IDs, unread state and all other header metadata
  remain unchanged. Its description explicitly distinguishes unread polling from cursor polling.

Assumptions: the user-facing MCP defaults for status and board acknowledgements may become
compact, with explicit full-response escape hatches. CLI and hub/agentd wire responses remain
unchanged. This is response-size reduction; it does not bound the existing IPC response or
implement pruning, topic mute, newest-first paging or cached offline reads.

Validation performed in the isolated checkout: workspace build passed; CLI typecheck passed;
13 MCP SDK tests passed, including summary/detail toggles, preserved diagnostics, exact RPC
argument forwarding, cursor/read-state preservation and malformed-option rejection. Parent
workflow owns the final integrated build/typecheck/test and review gates.
