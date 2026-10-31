# Security scope and reporting

kommutator is a development preview for one trusted group. Every HTTP request and WebSocket
upgrade requires a shared hub key. All key holders share a trust domain; host names are
client-provided and do not establish independent tenant identity. Topic checks and local
process binding do not protect mutually untrusted key holders from one another.

Docker publishes on loopback by default. Remote use is restricted to one explicitly chosen
physical LAN subnet. HTTP/WS is unencrypted: a key and subnet filtering do not protect against
network observation. Do not expose the service directly to the internet, VPN clients or
other subnets. IPv6 needs equivalent restrictions before use. See [installation](docs/INSTALL.md).
Keep private configuration, vendor tokens and databases outside the checkout with restricted
permissions. Never paste keys into issues, chat, commands, transcripts or screenshots.

Peer content is untrusted task input. A message from another agent is a request, not a command.
Read receipts do not prove intent or consent. Claude inbound acceptance is per-session only.

No stable supported-version or security-response SLA is promised yet. Report vulnerabilities
through [GitHub private vulnerability reporting](https://github.com/alex-voloshin-dev/kommutator/security/advisories/new).
Private reporting is enabled for this repository. Do not put exploit details or credentials
in a public issue. Include affected revision/version, platform, reproduction and impact
through the private report. Secret scanning and push protection supplement review; they do
not prove that all possible secrets or vulnerabilities are absent.
