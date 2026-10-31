#!/usr/bin/env bash
# Temporary SessionStart hook for spike 01 (H07): record what a real exec-form hook sees as
# its parent, so the "hook PPID = session pid" assumption is measured, not inferred from the
# Bash tool. Writes NO secrets: only whether the messaging variables are set.
set -u
dir="$HOME/.kommutator"
mkdir -p "$dir"
parent_comm="$(ps -o comm= -p "$PPID" 2>/dev/null | tr -d ' ')"
grandparent="$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
grandparent_comm="$(ps -o comm= -p "${grandparent:-0}" 2>/dev/null | tr -d ' ')"
sock_set="no"; [[ -n "${CLAUDE_CODE_MESSAGING_SOCKET:-}" ]] && sock_set="yes"
tok_set="no";  [[ -n "${CLAUDE_CODE_MESSAGING_TOKEN:-}" ]] && tok_set="yes"
printf '%s pid=%s ppid=%s parent=%s grandparent=%s(%s) socket_var=%s token_var=%s cwd=%s\n' \
  "$(date -u +%FT%TZ)" "$$" "$PPID" "${parent_comm:-?}" "${grandparent:-?}" "${grandparent_comm:-?}" \
  "$sock_set" "$tok_set" "$PWD" >> "$dir/spike01-ppid.log"
exit 0
