#!/usr/bin/env bash
# Stop hook for spike 04. Reads the hook payload from stdin, logs it, and — once per armed
# session — blocks the stop with a reason that asks the agent to handle an "unread message".
#
# Arm it for one session:   touch ~/.kommutator/spike04-fire.<session_id>
# Arm it for the next session that stops, whoever it is:   touch ~/.kommutator/spike04-fire.any
#
# Each flag is a separate file claimed atomically with mv, so two sessions stopping at the
# same time cannot both fire on one flag, and nothing is ever put back (R09). A payload
# without a session id, or that is not JSON, never consumes a per-session flag.
set -u
dir="$HOME/.kommutator"
mkdir -p "$dir"
payload="$(cat)"
printf '%s  %s\n' "$(date -u +%FT%TZ)" "$payload" >> "$dir/spike04.log"

# Parse the JSON properly (field spacing varies between vendors and versions).
read -r active sid < <(node -e '
  let d = ""; process.stdin.on("data", c => d += c).on("end", () => {
    let j = null; try { j = JSON.parse(d); } catch {}
    const ok = j && typeof j === "object";
    console.log(String(ok && j.stop_hook_active === true), ok && typeof j.session_id === "string" ? j.session_id : "");
  });' <<<"$payload")

# Claude Code sets stop_hook_active=true when the turn is already a continuation caused by
# a Stop hook. Never block again in that case.
if [[ "$active" == "true" ]]; then
  exit 0
fi

claim="$dir/spike04-claimed.$$"
fired=""
# 1) a flag armed for exactly this session (only when the payload carries a valid id)
if [[ -n "$sid" && "$sid" =~ ^[A-Za-z0-9._-]+$ ]] && mv "$dir/spike04-fire.$sid" "$claim" 2>/dev/null; then
  fired="session $sid"
# 2) a flag armed for whoever stops next
elif mv "$dir/spike04-fire.any" "$claim" 2>/dev/null; then
  fired="any"
fi

if [[ -n "$fired" ]]; then
  rm -f "$claim"
  printf '%s  fired for %s\n' "$(date -u +%FT%TZ)" "$fired" >> "$dir/spike04.log"
  cat <<'JSON'
{"decision":"block","reason":"[kommutator spike04] You have 1 unread message from reviewer@laptop: \"ping — please reply with the single word pong\". Reply now, then you may stop."}
JSON
fi
exit 0
