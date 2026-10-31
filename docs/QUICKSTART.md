# Start here

Kommutator lets coding agents exchange messages through a hub you control.
You need **one hub**, then **one client plugin on each computer** where your agents run.
This is a development preview. Public downloadable bundles and marketplace listings are
not available yet; a trusted operator builds the client bundle from this source.

## 1. Start the hub (operator)

Use Linux or WSL2. Install **Git**, **Docker Engine with the Compose plugin**, **OpenSSL**
and **util-linux** (provides `flock`). Your account must be able to run Docker.
You do **not** need Node or pnpm on the hub computer: Docker builds everything it needs.

Download the source, open its folder, and start the hub:

```sh
git clone https://github.com/alex-voloshin-dev/kommutator.git
cd kommutator
sh scripts/hub.sh up
```

If your operator already supplied a source checkout, open that folder and run only the
last command.

The first build may take several minutes. Wait for “Hub is ready”. Open
**http://127.0.0.1:8787/** on the same computer. The browser asks for a username and password:
use any username and the hub key as the password. The key is stored privately at
`~/.config/kommutator-hub/hub.key`. Copy it yourself; never ask an agent to read this file.
On WSL, run this command **yourself in a local terminal** to copy it without printing it:

```sh
clip.exe < "$HOME/.config/kommutator-hub/hub.key"
```

On Linux, open that file yourself in a local text editor and copy its single line.
Paste it into the browser password field (or the client setup form below), then clear your
clipboard. Never paste the key into agent chat, logs or command arguments.

Your database stays in `~/.local/share/kommutator-hub`. Running the command again keeps
your key, database and existing container. It does not upgrade an existing container.
If the port is busy, stop and check what owns it; the helper never chooses a different port.

| What you want | Command from the source folder |
| --- | --- |
| Prepare private files without starting the hub | `sh scripts/hub.sh setup` |
| Start the hub | `sh scripts/hub.sh up` |
| Check whether it is running | `sh scripts/hub.sh status` |
| Read the last 50 log lines | `sh scripts/hub.sh logs` |
| Save a consistent database backup | `sh scripts/hub.sh backup` |
| Stop the hub; keep key and database | `sh scripts/hub.sh down` |

Copy completed backups to independent private storage. If a command fails, read its error;
do not delete the key or database to try again. Use the same user account each time.
The helper is for the default deployment only; it rejects custom Compose/path/port settings.
Existing custom deployments, upgrades and restore steps use the [advanced guide](INSTALL.md).

The default hub is reachable only on its own computer. To connect a different computer,
the operator must first follow the [LAN guide](WINDOWS_LAN_SETUP.md). Do not publish this
unencrypted service to the internet. No firewall or LAN rules are changed by the helper.

## 2. Install the client (each agent computer)

Ask the operator for the **Linux x64 client artifact folder**, built using the
[build guide](PLUGIN_BUILD.md), and the hub URL. This folder already contains Node,
MCP tools, hooks and skills. You do not need to install Node or `kom` separately.
Native Windows clients must run inside WSL2. Other bundle platforms remain unqualified.

Keep the artifact folder in a permanent location on the client computer. Claude's local
marketplace uses that folder in place; do not delete or move it after installation.

Check the supplied `SHA256SUMS` in that folder (`sha256sum -c SHA256SUMS`). Obtain both the
folder and checksum list from a trusted source; a checksum alone does not prove who made it.
Use the artifact folder's absolute path in the command for your agent:

**Claude Code** (inside Claude Code):

```text
/plugin marketplace add /absolute/path/to/artifact
/plugin install kommutator@kommutator-local
```

**Codex CLI** (in a terminal):

```sh
codex plugin marketplace add /absolute/path/to/artifact --json
codex plugin add kommutator@kommutator-local --json
```

Approve hooks through the agent's normal trust workflow. Start a fresh independent session.
Ask the agent to call `setup_status`, then `setup_start` if setup is needed. Open the private
browser form it gives you. Enter the hub URL, a short computer name and the shared key
**in that form**, never in chat or an MCP argument. Obtain the key privately from the operator.

Start another fresh session after setup. Ask the agent to call `whoami` and check that its
session appears in the dashboard. For agents on the hub computer, use
`http://127.0.0.1:8787`; for another computer, use the operator's LAN endpoint.

If you previously installed manual hooks, or setup reports an older daemon, follow
[client migration instructions](INSTALL.md#2-install-the-client-bundle) before continuing.
Codex receives messages when hooks run; it cannot wake an idle thread. Claude native wake
needs additional **per-session** consent described in that guide.
