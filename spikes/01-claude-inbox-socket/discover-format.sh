#!/usr/bin/env bash
# Locate the installed Claude Code and print the string literals around the inbox-socket
# protocol, so we can see the message line schema the socket expects.
# Needs `file` and `strings` (Xcode Command Line Tools on macOS).
set -euo pipefail

cli="$(command -v claude || true)"
if [[ -z "$cli" ]]; then
  echo "claude not found on PATH" >&2
  exit 1
fi
cli="$(readlink -f "$cli" 2>/dev/null || python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$cli")"
echo "claude resolves to: $cli"
echo "version: $(claude --version 2>/dev/null | head -1)"

# Native installs keep the JS bundle next to the launcher or inside a versions/ dir.
candidates=("$cli")
dir="$(dirname "$cli")"
while IFS= read -r f; do candidates+=("$f"); done < <(find "$dir" "$dir/.." -maxdepth 3 -type f \( -name 'cli.js' -o -name 'claude' -o -name '*.js' \) -size +1M 2>/dev/null | sort -u)

dump() {
  local f="$1"
  if file "$f" | grep -qiE 'javascript|text'; then
    cat "$f"
  else
    strings -n 6 "$f"
  fi
}

# Minified bundles write object keys unquoted (type:"auth"); npm installs may keep quotes.
TYPE_RE='"?type"?:"[A-Za-z_]+"'

for f in "${candidates[@]}"; do
  if ! grep -q "CLAUDE_CODE_MESSAGING_TOKEN" <(dump "$f" 2>/dev/null); then
    continue
  fi
  echo
  echo "=== $f ==="
  echo "--- type literals by frequency (look for message/peer-ish names) ---"
  dump "$f" | grep -oE "$TYPE_RE" | sed 's/"//g' | sort | uniq -c | sort -rn | head -40
  echo
  echo "--- 400 chars of context around type:\"auth\" ---"
  dump "$f" | grep -oE ".{0,400}\"?type\"?:\"auth\".{0,400}" | head -5
  echo
  echo "--- context around CLAUDE_CODE_MESSAGING_SOCKET ---"
  dump "$f" | grep -oE '.{0,300}CLAUDE_CODE_MESSAGING_SOCKET.{0,300}' | head -5
  echo
  echo "--- object literals mentioning from + (text|content|message|body) ---"
  dump "$f" | grep -oE '\{[^{}]{0,160}\bfrom\b[^{}]{0,160}\}' | grep -E 'text|content|message|body' | sort -u | head -20
  exit 0
done

echo "Could not find a bundle containing CLAUDE_CODE_MESSAGING_TOKEN under $dir." >&2
echo "Try: find ~ -name 'cli.js' -path '*claude-code*' 2>/dev/null" >&2
exit 2
