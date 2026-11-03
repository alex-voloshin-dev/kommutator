---
type: ux-spec
feature: dashboard-usability
status: approved
flows:
  - Understand hub freshness and current activity at a glance.
  - Find a session by name, role, host, project or status and inspect its details.
  - Find a topic and see which sessions are subscribed, separating current and ended sessions.
  - Read recent deliveries and meaningful live events without parsing JSON.
screens:
  - One read-only dashboard with overview, sessions, topics, deliveries and activity sections.
  - Each section has initial loading, empty, filtered-empty, error/stale and populated states.
accessibility:
  - Native keyboard-operable links, inputs, selects, buttons and disclosure controls.
  - Visible focus, semantic headings and landmarks, labelled controls and polite bounded status updates.
  - WCAG AA contrast and usable reflow at 320 CSS pixels and 200 percent zoom.
design_system:
  - Reuse system typography, native controls, textContent rendering and existing snapshot/SSE behavior.
  - Define small CSS custom-property tokens for surface, text, muted text, border, accent, status, spacing and radius.
---

# Dashboard usability

The user's request is the feature input: make the existing dashboard easier to understand,
show topics and their subscribers, and remove verified test data. The database cleanup is an
operator task outside the read-only dashboard; no delete controls, write endpoints or keys in
URLs/storage are introduced. Existing authentication and receipt semantics remain unchanged.

## Information hierarchy and flows

1. Header: product name, read-only label, connection/freshness indicator, last successful
   refresh, and a manual Refresh button. Section links jump to Overview, Sessions, Topics,
   Deliveries and Activity. A skip link reaches main content. Status communicates fresh,
   refreshing, reconnecting or stale without relying on color.
2. Overview: current session count (not ended, not a claim of human presence), active/idle
   breakdown, represented hosts and topic count. Clearly distinguish current counts from
   retained history and bounded delivery/event windows. During first load show placeholders,
   never misleading zero counts; retain previous values labelled stale on failures.
3. Sessions: current sessions first and shown by default, with an explicit Include ended
   control. Search name/handle, role, host, project and status; keep state/wake filters and
   Clear filters. Cards prioritize name, state, role, host, project and status. Technical IDs,
   vendor session facts and capability/wake belong in an optional Details disclosure.
   Filters operate on the retained snapshot; explain its ended-history limit (100).
   Selecting the gone state automatically enables Include ended. Turning Include ended
   off clears a gone-state selection. Clear filters returns to current sessions only.
4. Topics: search and kind filter (all/ad-hoc/project/global). Show name, kind and current
   subscriber count; expanding a topic reveals subscribed sessions with name/handle, host,
   role, vendor and state. Include ended is explicit; total membership counts must remain
   accurate even when older ended sessions fall outside the snapshot retention window.
   Distinguish no members, no current members, and older ended subscribers not displayed.
   Never infer membership from a session's project or name. Reuse actual membership rows.
5. Deliveries: retain the latest 200 individual recipient deliveries, clearly labelled as
   deliveries rather than unique messages. Show readable sender/recipient, subject and
   bounded preview, timestamp and Marked read/Pending receipt text. Include a nearby plain
   explanation that marked read is bookkeeping, not proof a task was handled. Search and
   receipt filtering are useful; no message body read is performed by viewing this page.
6. Activity: latest 200 events since connection, newest first, with event type and short
   human-readable summary plus timestamp. Technical JSON is secondary, inside a bounded
   Details disclosure. Explain that missed SSE events are not replayed; reconnect refreshes
   snapshots. Do not expose internal deliver replays or raw bodies/tokens.

## States and refresh behavior

Every data section has initial loading, successful empty, filtered empty with Clear filters,
loaded and unavailable states. Initial failure explains retry and exposes Refresh. Later
failure retains the prior snapshot with an explicit stale indication; automatic retry and
manual refresh recover without reload. Permanent SSE closure explains that reload reconnects.
Provide a native Pause updates / Resume updates toggle. While paused, freeze visible snapshot
data and activity; keep filters and disclosures usable, and clearly label data as paused/stale.
Discard incoming activity during pause (no unbounded buffer) and explain the resulting gap.
Manual Refresh fetches and displays one snapshot without unpausing; Resume fetches a fresh
snapshot and resumes subsequent live events. Do not silently refresh visible data during pause.
Topics and membership changes must refresh even without a message/session event; use a bounded
periodic snapshot refresh or explicit topic-change notifications, with requests coalesced.
In-flight events trigger a subsequent refresh; malformed responses do not erase known-good
content. Keep existing bounded timeout and retry behavior.

Selections and disclosure state survive refresh. Focus must not be lost or jump when data is
updated; preserve keyed elements or restore focus to its stable control. If the focused item
is removed, move focus to the associated section heading and announce the change politely.
Do not announce every heartbeat or rerender the entire interface in a live region.

## Components and accessibility

- Navigation: native anchor links with visible focus, sensible DOM order, sticky behavior only
  if it cannot cover focused content. No custom tab keyboard model is required.
- Search/filter/Refresh controls: native elements, persistent visible labels, accessible names,
  default/hover/focus/active states. Refresh disabled only during an active fetch with loading
  status; errors leave it available. Clear filters resets all filters including ended visibility.
- Cards and topic disclosures: semantic headings/lists and native details/summary; Enter/Space
  toggles, Tab reaches each disclosure in content order. Use text badges as well as color.
- Delivery rows: semantic table with caption/headers on wide screens or labelled stacked rows
  at narrow widths. Long identifiers wrap. The document must not require horizontal scrolling
  at 320 CSS pixels or 200 percent zoom; technical details can wrap within their container.
- Feedback: one concise polite connection/status region plus meaningful result-count updates;
  error text tied to the affected region. Decorative icons, if any, are hidden from assistive
  technology. No motion is required; honor reduced-motion if transitions are added.
- Tokens: system font, distinct surface/text/muted/border/accent/status variables, small spacing
  scale and corner radius; light/dark variants retain 4.5:1 text and 3:1 control/focus contrast.
  Noninteractive content has no disabled/active state; explicitly avoid fake button styling.

## Acceptance and evidence boundary

Exercise empty data, filters with no results, topic membership changes, old ended members,
malicious text, refresh failures and recovery, keyboard navigation, disclosure/focus retention,
mobile reflow, pause/manual-refresh/resume, and a real browser screenshot with synthetic fixtures. Run authenticated live
read-only checks after deployment. Never use production bodies or keys in public screenshots.
The UI does not claim native vendor wake, subnet isolation or day-long operation evidence.
