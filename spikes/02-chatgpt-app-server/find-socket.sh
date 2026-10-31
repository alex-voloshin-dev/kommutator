#!/usr/bin/env bash
# Find unix sockets that could be the Codex app-server control socket of the running
# ChatGPT desktop app (or a Codex process). Prints candidates; pick the one that answers.
set -uo pipefail

echo "== processes =="
ps -axo pid,comm,args | grep -iE 'chatgpt|codex|app-server' | grep -v grep | cut -c1-160

echo
echo "== unix sockets held by those processes (lsof -U) =="
pids="$(ps -axo pid,comm,args | grep -iE 'chatgpt|codex|app-server' | grep -v grep | awk '{print $1}' | paste -sd, -)"
if [[ -n "$pids" ]]; then
  lsof -U -a -p "$pids" 2>/dev/null | grep -vE '^COMMAND' | awk '{print $1, $2, $NF}' | sort -u
else
  echo "(no matching processes — is the ChatGPT app running?)"
fi

echo
echo "== socket files in the usual places =="
for d in "$HOME/.codex" "$HOME/Library/Application Support/com.openai.chat" "$HOME/Library/Application Support/ChatGPT" "$HOME/Library/Application Support/Codex" "$HOME/Library/Caches" "$TMPDIR" /tmp; do
  [[ -d "$d" ]] || continue
  find "$d" -maxdepth 4 -type s 2>/dev/null | sed "s|^|  |"
done

echo
echo "== config hints =="
grep -nE 'app.?server|socket|listen' "$HOME/.codex/config.toml" 2>/dev/null | head -10 || echo "  (no ~/.codex/config.toml hints)"
echo
echo "Export the winner:  export SOCK=/path/to/socket   then:  node client.mjs list"
