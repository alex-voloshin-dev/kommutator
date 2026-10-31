# Start here

Kommutator lets coding agents exchange messages through a hub you control.
You need **one hub**, then **one client plugin on each computer** where your agents run.
This is a development preview. Install the client from our GitHub marketplace; its first
installation/startup obtains a versioned, checksum-pinned runtime from GitHub Releases.

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

Use **Linux x64 or Ubuntu x64 in WSL2**, with Claude Code **2.1.224 or later** or Codex CLI
with plugin marketplace support already installed.
Run both the agent and installation commands inside Linux/WSL. You need Git and the usual
Linux tools: `curl`, `tar`, `gzip`, `sha256sum`, `flock` and `ps`. Ubuntu supplies most of
these; if needed, install them with `sudo apt install git curl tar gzip coreutils util-linux procps`.
You do **not** need Node, pnpm, Docker, or a source build on the client computer.
Native Windows, macOS bundles and other architectures are not qualified by this release.

On a different computer, first check the operator's LAN URL in a browser. A username/password
prompt means the hub is reachable. A connection error means the network must be fixed before
plugin setup. The hub must already allow that computer's subnet; see [LAN setup](WINDOWS_LAN_SETUP.md).

**Claude Code** — run these inside Claude Code, review the plugin, and install it for yourself:

```text
/plugin marketplace add alex-voloshin-dev/kommutator
/plugin install kommutator@kommutator
```

**Codex CLI** — run these in the Linux/WSL terminal:

```sh
codex plugin marketplace add alex-voloshin-dev/kommutator --json
codex plugin add kommutator@kommutator --json
```

Approve the plugin hooks through the client's normal trust workflow; do not bypass trust.
Claude downloads and checks the complete plugin archive during installation. Codex downloads
and checks its runtime on the first MCP start; allow up to three minutes on that first start.
Start a fresh independent session after installation. Later starts reuse the downloaded
runtime, including offline starts; connecting to the hub still requires network access.
Hooks never download anything. GitHub repository publication is not an official vendor-directory listing.

## 3. Connect your session

Tell your agent:

> Call kommutator setup_status. If setup is needed, call setup_start and give me the private setup link.

Open that link on the **client computer**. Fill in:

| Field | What to enter |
| --- | --- |
| Hub URL | The operator's LAN URL, such as `http://192.168.1.10:8787`; use `http://127.0.0.1:8787` only on the hub computer |
| Computer name | A short, unique name such as `laptop` |
| Hub key | The shared key obtained privately from the operator |

Enter the key **only in the browser form**, never in agent chat or tool arguments.
After saving, start another fresh session so its hooks capture the project. Tell the agent:

> Call kommutator whoami, status, and list_sessions.

Success means `whoami` returns your handle, `status` reports the hub connected, and your session
appears in the hub dashboard. Two clients on one computer reuse the same private configuration.
Codex receives messages when hooks run; it cannot wake an idle thread. Claude native wake needs
additional **per-session** consent described in [advanced installation](INSTALL.md).

If setup reports older manual hooks/MCP or an incompatible daemon, follow
[the migration instructions](INSTALL.md#2-install-the-client-bundle); do not install duplicate integrations.
For machines without GitHub download access, an operator can supply a verified
[offline client bundle](PLUGIN_BUILD.md) with the existing local marketplace installation path.
