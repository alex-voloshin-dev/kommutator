#!/bin/sh
# Linux / WSL2 helper for the default, local Docker Compose hub.
set -eu
umask 077
fail() { printf 'Hub: %s\n' "$*" >&2; exit 1; }
action=${1:-help}
[ "$#" -le 1 ] || fail 'Use one command: setup, up, status, logs, backup or down.'
case "$action" in
  help|--help|-h)
    printf 'Usage: sh scripts/hub.sh {setup|up|status|logs|backup|down}\nSee docs/QUICKSTART.md. No host Node installation is needed.\n'
    exit 0 ;;
  setup|up|status|logs|backup|down) ;;
  *) fail 'Unknown command. Use setup, up, status, logs, backup or down.' ;;
esac
[ "$(uname -s)" = Linux ] || fail 'This helper supports Linux and WSL2; see docs/INSTALL.md.'
for command in docker openssl flock stat; do
  command -v "$command" >/dev/null 2>&1 || fail "Install $command first (Docker Compose, OpenSSL and util-linux are required)."
done
docker compose version >/dev/null 2>&1 || fail 'Install the Docker Compose plugin first.'
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || fail 'HOME must name your existing home directory.'
# This entrypoint deliberately has one deployment configuration. Use the advanced
# guide for custom paths or LAN deployments, without silently migrating them here.
for variable in KOM_KEY_FILE KOM_DATA_DIR KOM_PUBLISH_HOST KOM_PUBLISH_PORT KOM_UID KOM_GID COMPOSE_FILE COMPOSE_PROJECT_NAME; do
  eval 'value=${'"$variable"'-}'
  [ -z "$value" ] || fail "Unset $variable before using the default helper; custom deployments use docs/INSTALL.md."
done
export KOM_UID=$(id -u) KOM_GID=$(id -g)
export KOM_KEY_FILE="$HOME/.config/kommutator-hub/hub.key"
export KOM_DATA_DIR="$HOME/.local/share/kommutator-hub"
export KOM_PUBLISH_HOST=127.0.0.1 KOM_PUBLISH_PORT=8787
config="$HOME/.config/kommutator-hub"
case "$config/" in "$root/"*) fail 'HOME state must be outside the checkout.' ;; esac
case "$KOM_DATA_DIR/" in "$root/"*) fail 'HOME state must be outside the checkout.' ;; esac
private_directory() {
  [ ! -L "$1" ] || fail 'State directories must not be symbolic links.'
  ancestor=$1
  while [ ! -e "$ancestor" ]; do ancestor=$(dirname -- "$ancestor"); done
  resolved=$(CDPATH= cd -- "$ancestor" && pwd -P)
  case "$resolved/" in "$root/"*) fail 'Resolved state must be outside the checkout.' ;; esac
  mkdir -p -- "$1"
  [ "$(stat -c %u -- "$1")" = "$KOM_UID" ] || fail 'State belongs to another user; inspect ownership before continuing.'
  chmod 700 -- "$1"
  resolved=$(CDPATH= cd -- "$1" && pwd -P)
  case "$resolved/" in "$root/"*) fail 'Resolved state must be outside the checkout.' ;; esac
}
private_directory "$config"
[ ! -L "$config/helper.lock" ] || fail 'Lock file must not be a symbolic link.'
exec 9>"$config/helper.lock"
flock -w 30 9 || fail 'Another hub command is still running. Try again later.'
compose() { docker compose --project-name kommutator --env-file /dev/null -f "$root/compose.yaml" "$@"; }
if [ "$action" = setup ] || [ "$action" = up ]; then
  private_directory "$KOM_DATA_DIR"
  if [ ! -e "$KOM_KEY_FILE" ] && [ ! -L "$KOM_KEY_FILE" ]; then
    temporary=$(mktemp "$config/.hub.key.XXXXXX")
    trap 'rm -f -- "$temporary"' EXIT
    trap 'exit 1' HUP INT TERM
    openssl rand -hex 32 > "$temporary" || fail 'Key generation failed; no key was installed.'
    [ "$(wc -c < "$temporary")" -eq 65 ] || fail 'Key generation returned unexpected output.'
    ln -- "$temporary" "$KOM_KEY_FILE" || fail 'Key appeared during setup; inspect it before retrying.'
    rm -f -- "$temporary"
    trap - EXIT HUP INT TERM
  fi
fi
[ -f "$KOM_KEY_FILE" ] && [ ! -L "$KOM_KEY_FILE" ] && [ -s "$KOM_KEY_FILE" ] || fail 'Private key missing or unsafe. Run setup, or inspect your existing deployment.'
[ "$(stat -c %u -- "$KOM_KEY_FILE")" = "$KOM_UID" ] || fail 'Key belongs to another user.'
[ -d "$KOM_DATA_DIR" ] && [ ! -L "$KOM_DATA_DIR" ] || fail 'Private data directory missing or unsafe.'
[ "$(stat -c %u -- "$KOM_DATA_DIR")" = "$KOM_UID" ] || fail 'Data belongs to another user.'
chmod 600 -- "$KOM_KEY_FILE"
# A Compose project name is shared across checkouts. Refuse to operate on a
# container created with another user's paths, identity or LAN configuration.
if [ "$action" != setup ]; then
  container=$(compose ps --all --quiet hub)
  if [ -n "$container" ]; then
    actual=$(docker inspect --format '{{.Config.User}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}|{{range .Mounts}}{{if eq .Destination "/run/secrets/hub_key"}}{{.Source}}{{end}}{{end}}|{{range (index .HostConfig.PortBindings "8787/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$container")
    data_path=$(CDPATH= cd -- "$KOM_DATA_DIR" && pwd -P)
    key_directory=$(CDPATH= cd -- "$config" && pwd -P)
    expected="$KOM_UID:$KOM_GID|$data_path|$key_directory/hub.key|127.0.0.1:8787"
    [ "$actual" = "$expected" ] || fail 'Existing hub uses different settings. It was not changed; use docs/INSTALL.md.'
  fi
fi
case "$action" in
  setup) printf 'Private hub files are ready. Start with: sh scripts/hub.sh up\n' ;;
  up)
    compose up -d --build --wait --no-recreate hub
    printf 'Hub is ready. Open http://127.0.0.1:8787/ (any username; private hub key as password).\nExisting containers are preserved; this command does not apply upgrades.\n' ;;
  status) compose ps --all hub ;;
  logs) compose logs --tail 50 hub ;;
  down)
    compose down
    printf 'Hub stopped. Your key and data remain in your home directory.\n' ;;
  backup)
    name="backup-$(date -u +%Y%m%d-%H%M%S)-$$.db"
    compose exec -T hub node /app/container/backup.mjs "/data/$name"
    printf 'Backup saved: %s/%s\nCopy it to independent private storage.\n' "$KOM_DATA_DIR" "$name" ;;
esac
