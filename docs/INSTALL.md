# Advanced installation and operations

For the shortest default setup, use the [quickstart](QUICKSTART.md) and `sh scripts/hub.sh up`.
This guide covers manual Compose configuration, client migration and source integration.
Do not mix custom Compose deployments with the default helper.

Use the [GitHub plugin installation](QUICKSTART.md#2-install-the-client-each-agent-computer)
for normal Linux x64 clients, and Docker Compose for the hub. The local bundle path below
is an offline/operator alternative; maintainers can [build the artifacts](PLUGIN_BUILD.md). macOS source-client evidence
exists, but exported macOS bundles remain unqualified. Native Windows clients, cloud Work
and Copilot are outside this installation path; Windows clients run inside WSL2.

## 1. Start a fresh hub

Install Docker Engine with Compose and OpenSSL on the Linux/WSL2 host, and open a shell at the checkout
root. The container build supplies Node and dependencies; normal hub operation does not
need host Node. Use a Docker-capable user account. The commands below create private files
owned by the current user and preserve an existing key. Do not use root to create these
files for another user; do not use world-writable permissions.

```sh
umask 077
mkdir -p "$HOME/.config/kommutator-hub" "$HOME/.local/share/kommutator-hub" || exit 1
chmod 700 "$HOME/.config/kommutator-hub" "$HOME/.local/share/kommutator-hub" || exit 1
(
  key_file="$HOME/.config/kommutator-hub/hub.key"
  if [ ! -e "$key_file" ] && [ ! -L "$key_file" ]; then
    key_temp=$(mktemp "$HOME/.config/kommutator-hub/.hub.key.XXXXXX") || exit 1
    trap 'rm -f "$key_temp"' EXIT
    openssl rand -hex 32 > "$key_temp" || exit 1
    test -s "$key_temp" || exit 1
    # Atomic, create-only: another successful setup may have created the key meanwhile.
    if ! ln "$key_temp" "$key_file" 2>/dev/null; then
      { test -f "$key_file" && test ! -L "$key_file" && test -s "$key_file"; } || exit 1
    fi
  fi
  { test -f "$key_file" && test ! -L "$key_file" && test -s "$key_file"; } || exit 1
) || { printf 'Key setup failed; inspect private files before continuing.\n' >&2; exit 1; }
chmod 600 "$HOME/.config/kommutator-hub/hub.key" || exit 1
export KOM_UID="$(id -u)"
export KOM_GID="$(id -g)"
export KOM_PUBLISH_HOST=127.0.0.1
export KOM_PUBLISH_PORT=8787
docker compose build
docker compose up -d --wait
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
```

The last command must report `401`. A healthy container proves the mounted-key healthcheck
can authenticate without printing the key. Open `http://127.0.0.1:8787/` in a local browser;
HTTP Basic accepts any username and the key as password. Retrieve the key only through your
private local secret workflow, never by printing it into agent logs, chat or command arguments.
The browser dashboard and a successful client `whoami` provide authenticated functional checks.

Keep the UID/GID exports in the shell used for later Compose operations, or persist those
non-secret values in a private Compose `--env-file` and pass it consistently. The default
UID/GID is 1000, which may not match your account. If files already belong to a different
account, correct their ownership deliberately before starting; do not broaden permissions.
The data mount must exist (Compose does not create it). `KOM_DATA_DIR` and `KOM_KEY_FILE`
can override the paths; `KOM_KEY_FILE` contains a filename, never the secret itself.
The key stays outside the image and the database persists across container recreation.

TCP **8787** is the stable service endpoint. Do not change it automatically if occupied.
Loopback is local-only. For clients on another host, follow [the LAN guide](WINDOWS_LAN_SETUP.md)
to enforce one explicit physical subnet before sharing an endpoint and key privately.
HTTP/WS is unencrypted and every key holder shares a trust domain. Do not expose directly
to the internet or assume subnet filtering encrypts traffic. See [SECURITY](../SECURITY.md).

## 2. Install the client bundle

On the client, obtain the locally built artifact directory through a trusted channel.
Verify its supplied `SHA256SUMS` from that directory (`sha256sum -c SHA256SUMS` on Linux).
A checksum detects corruption relative to that manifest; it does not authenticate its publisher.
The artifact root contains both local catalogs. Use its absolute local path, not a Git URL
pointing at this source tree.

Claude Code:

```text
/plugin marketplace add /absolute/path/to/artifact
/plugin install kommutator@kommutator-local
```

Codex CLI:

```sh
codex plugin marketplace add /absolute/path/to/artifact --json
codex plugin add kommutator@kommutator-local --json
```

Trust hooks using the vendor's normal workflow, including exact-hash checks where offered.
Start a fresh independent session. Call `setup_status`; if unconfigured, call `setup_start`
and open its loopback browser form. Enter the hub URL, host alias and shared key **in that
private form**, never in chat. Existing private config is reused. Do not submit the key as
an MCP argument. Both vendors share configuration and daemon state outside plugin caches.
The first authenticated session call needs a matching hook project observation. For Claude,
if installation or setup happened during the conversation, run `/exit`, then run
`claude --resume` in a terminal in the same project and select this conversation. Trust the
updated plugin hooks so `SessionStart` can register it. `/reload-plugins` alone is insufficient,
and submitting another prompt does not create the registration. Then call `whoami` and inspect
the dashboard. `setup_status` configuration and daemon compatibility do not prove session
registration. For Codex, start a fresh independent session if setup occurred after its initial hooks.

Back up vendor settings before removing old manual `kom hook` / `kom mcp` entries if setup
reports a conflict. Do not run manual and bundled hooks together or bypass trust checks.
A running older daemon is not automatically replaced. After ending active sessions, use
`/installed/plugin/path/bin/manage daemon restart` if `setup_status` reports incompatibility.
POSIX utilities and `ps` are still required; system Node and `kom` are not required by a bundle.

Claude native idle wake in bypass sessions requires explicit per-session
`crossSessionInbound: accept`, together with `KOM_CLAUDE_INBOUND_POLICY=accept` in that launch's
environment. The marker only reports the actual setting; it does not change Claude policy.
Never enable it globally. Bypass/default was observed Held. See the
[Claude integration details](../plugins/claude-code/README.md). Codex delivers on hooks;
it cannot wake an already idle thread. Desktop UI acceptance is separate from CLI evidence.

### Updating the GitHub plugin

Version 0.2.0 has a conflict-detector bug: Claude's normal marketplace registration can be
reported as an older manual integration. Update to 0.2.1 or later; **keep** the
`extraKnownMarketplaces.kommutator` entry. Removing the marketplace is not the fix.

Inside Claude Code:

```text
/plugin marketplace update kommutator
/plugin update kommutator@kommutator
```

For Codex CLI:

```sh
codex plugin marketplace upgrade kommutator --json
codex plugin add kommutator@kommutator --json
```

Restart the session and approve changed hooks through the vendor's normal trust workflow.
For Claude, run `/exit`, then `claude --resume` in a terminal in the same project and select
the conversation; `/reload-plugins` alone does not replace its `SessionStart` registration.
The saved hub URL/key remain in private client configuration. Check `setup_status`, then
`whoami` and `list_sessions`; a successful MCP initialization alone does not prove the
configured session can register. If a real manual MCP server or hook remains, the migration
checks still apply: inspect it and back up settings before deliberate removal.

## 3. Operations

Use [OPERATIONS](OPERATIONS.md) for doctor/status and bounded logs. Container operations:

```sh
docker compose logs --tail 50 hub
docker compose restart hub
# Intentional stop; persistent data and key remain:
docker compose down
# Consistent online backup to a new filename:
docker compose exec -T hub node /app/container/backup.mjs /data/backup-$(date +%Y%m%d-%H%M%S).db
```

Copy completed backups to independent private storage. Never copy a live SQLite database
alone: committed data may remain in its WAL. Restore only while stopped, preserve the old
DB/WAL/SHM as a rollback set, and restore ownership and 0600 permissions before restart.
`restart: unless-stopped` handles Docker restarts, but host boot/login behavior needs its
own observed test. Hard-kill interruption of snapshot locking may require a fresh vendor
session. Measured Codex hook end-to-end latency was roughly 0.75 seconds, despite bounded
hook command work; no universal latency guarantee is implied.

## Advanced: manual source integration

Build using [CONTRIBUTING](../CONTRIBUTING.md). Put `packages/cli/dist/index.js` on the
client's actual launch PATH as `kom`, with Node 26.13.0 available there (GUI PATH can differ).
Before either vendor's manual commands, configure the connection. The following Bash/zsh
example accepts the key privately with terminal echo disabled, exports it only for `kom init`,
and clears it afterwards. Never pass `--key` or put a literal secret in shell history.

```sh
old_tty_state=$(stty -g)
trap 'stty "$old_tty_state"; unset KOM_KEY' EXIT INT TERM
printf 'Hub key (hidden): ' >&2
stty -echo
IFS= read -r KOM_KEY
stty "$old_tty_state"
printf '\n' >&2
export KOM_KEY
kom init --hub http://127.0.0.1:8787 --no-hooks
unset KOM_KEY
trap - EXIT INT TERM
```

Use the real reachable URL for a remote hub. Configuration is stored privately (0600).
Then follow the manual [Claude](../plugins/claude-code/README.md) or
[Codex](../plugins/codex/README.md) instructions. This advanced path is an alternative to
bundled installation, not an additional required step.

Bundled Linux Node 26.13.0 requires libatomic.so.1. On Ubuntu, install the libatomic1
package if the launcher reports that library missing; the Docker hub supplies it in-image.
