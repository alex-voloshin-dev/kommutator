# How releases will be distributed

The public Git repository contains source. Client binaries, container images and official
vendor listings are separate releases. Until a release asset exists, use
[the quickstart](QUICKSTART.md) and an operator-built client bundle.

| What you need | Planned download | What is inside |
| --- | --- | --- |
| Client for Linux x64 / WSL2 | A versioned `.tar.gz` attached to a GitHub Release | Claude/Codex plugins, skills, MCP server, hooks, Node, licenses and checksums |
| Hub | Public `ghcr.io/alex-voloshin-dev/kommutator-hub` image | Hub, dashboard and SQLite runtime |
| Development source | This repository | Code, tests, documentation and build tools |

## Client experience

Download the matching client asset, not GitHub's automatic “Source code” archive. Check its
archive checksum, extract into a folder you will keep, and follow the two installation
commands for your agent in [QUICKSTART](QUICKSTART.md#2-install-the-client-each-agent-computer).
Approve hooks normally, then enter the connection details in the private browser form.
No separate Node install is needed. Both agents on one computer reuse the connection.

Local catalogs are the first release route. A later hosted Claude catalog may reference
release archives. OpenAI public listing currently excludes lifecycle hooks and restricts
local MCP submissions; manual installation preserves functionality. Copilot and other
platforms require their own tests. See the [source-backed research](sdlc/public-launch/research-brief.md).

## Hub experience

The current quickstart builds the image with Docker. The planned binary release adds a
pull-only Compose file that uses a fixed image digest. It keeps the same private key, data
storage, loopback endpoint and TCP 8787. Users should not need a registry account to pull
the public image. A registry image does not configure LAN access or make the service safe
for internet exposure.

## Maintainer release checklist

1. Choose the release commit/version and run `pnpm release:check`, source/history secret
   scanning and the relevant real-client checks. Document any preview limitations.
2. Export the client bundle, create its archive and checksum, then test the downloaded and
   extracted copy. Keep executable permissions and all license notices.
3. Publish the hub image from the same revision with source/version/revision/license labels.
   Explicitly make the GHCR package public; test anonymous pull and a fresh isolated hub.
4. Record the image digest in the release deployment file. Never replace an existing
   version tag or asset silently; issue a new version for corrections.
5. Attach instructions and the verified platform/client matrix to the release. Only then
   replace the quickstart's operator-build wording with the actual download link.

No binary release, container push or marketplace registration is performed by ordinary CI.
GitHub-hosted release publication is a separate maintainer action.
