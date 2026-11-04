# v0.8.1 installed validation

Observed on 2026-11-03 in the existing WSL/Docker installation.

- Release [v0.8.1](https://github.com/alex-voloshin-dev/kommutator/releases/tag/v0.8.1)
  uses commit `dfa7250c576a2f66e68f665cd9bd02f320f7fdcc`; all four anonymously downloaded
  assets matched the locally qualified files byte-for-byte.
- [PR 2](https://github.com/alex-voloshin-dev/kommutator/pull/2) merged after CI passed.
  Release checks: 41745857694 (tag), 41745910704 (branch), 41745917136 (PR).
  Secret scans: 41745857375, 41745910715, 41745917178.
- The full local release gate passed, including dependency audit, 448 workspace tests,
  release-script tests, export verification, clean-environment Claude/Codex startup and
  exported synthetic-client E2E. Source/history and payload secret scans passed.
- The supported local updater completed with checkpoint `idle`, applied version `0.8.1`
  and no error. Its private attempt directory retains hub/agentd backups. Docker image
  `kommutator-hub:release-0.8.1` is healthy. Agentd reports 0.8.1, runtime contract 3,
  connected hub, healthy global state and zero outbox depth. The developer root survived.
- The real Claude CLI refreshed the GitHub marketplace and updated the enabled user-scope
  plugin from 0.7.0 to 0.8.1. The CLI explicitly requires a restart to apply it to an
  existing conversation; installing does not manufacture a SessionStart registration.
- A CLI-only exact-owner diagnostic query against the upgraded daemon reported the affected
  caller as `gone`, reason `unknown`, with degraded caller health and explicit exit/resume
  guidance, while shared daemon health remained healthy. The local record was compared
  before/after and was identical: diagnostics did not revive or alter it. Local schema is 3.
- Feedback observer, maintainer and release-deploy timer are enabled and active again.

The affected live Claude process was not killed or manually registered. Its older unknown
retirement remains fenced until a genuine SessionStart. Live post-resume success therefore
is not claimed; the operator was given `/exit`, then `claude --resume` guidance. The original
retirement cause remains unproved. No key, token, production message body or private database
was included in the repository or release.
