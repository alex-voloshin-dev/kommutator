# Spike 04 — can a `Stop` hook make the agent keep going?

**Question.** The Stop-time poll (DESIGN.md §6) relies on a `Stop` hook returning
`{"decision":"block","reason":"…"}` so the agent handles unread messages before going idle.
Both hooks references document this. What the docs do not settle, and this spike records:

- Claude Code: that the re-entry carries `stop_hook_active: true` (our loop guard).
- Codex: that `Stop` blocking works from the CLI *and* inside a ChatGPT desktop-app thread,
  and that a `UserPromptSubmit` hook's stdout really is injected as developer context (the
  same script, wired to `UserPromptSubmit`, prints a marker line — look for it in the reply).

`stop-hook.sh` fires once per armed flag. Flags are separate files:
`~/.kommutator/spike04-fire.<session_id>` arms one session, `~/.kommutator/spike04-fire.any`
arms whichever session stops next. A flag is claimed atomically with `mv` and never put
back, so concurrent sessions cannot both fire on it and a late stop cannot be lost to a
restore race. A payload with no valid `session_id` (or that is not JSON) never consumes a
per-session flag. Claude Code passes `stop_hook_active: true` on the re-entry; the script
parses the payload as JSON and exits quietly when it sees it.

## Claude Code

1. Add to `~/.claude/settings.json` (or the project's `.claude/settings.local.json`):

   ```json
   {
     "hooks": {
       "Stop": [
         { "hooks": [ { "type": "command", "command": "bash /Users/<you>/kommutator/spikes/04-stop-hook/stop-hook.sh" } ] }
       ]
     }
   }
   ```

2. Arm the flag — for whichever session stops next, or for one session id (ask the session
   to print its `session_id` from `env`, or take it from `~/.kommutator/spike04.log` after a
   first run):

   ```bash
   mkdir -p ~/.kommutator && touch ~/.kommutator/spike04-fire.any
   # or, for one session: touch ~/.kommutator/spike04-fire.<session_id>
   ```

3. Start Claude Code, send any trivial prompt ("say hi"). When the turn ends, the hook
   fires. **Pass:** Claude continues with a new turn that replies "pong", exactly once; the
   log then shows the re-entry payload with `stop_hook_active: true`.
4. Remove the hook from settings afterwards.

## Codex CLI and ChatGPT desktop app

1. Hooks are on by default. In `~/.codex/hooks.json` (user-wide; a project-local file must be
   trusted once via `/hooks`):

   ```json
   {
     "hooks": {
       "Stop": [ { "hooks": [ { "type": "command", "command": "bash /Users/<you>/kommutator/spikes/04-stop-hook/stop-hook.sh" } ] } ],
       "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "echo '[kommutator spike04] prompt hook ran'" } ] } ]
     }
   }
   ```

2. Same flag file, same trivial prompt, first in `codex` (CLI), then in a Work thread of the
   ChatGPT desktop app. Record per surface whether Codex continues, ignores the output, or
   errors, and whether the prompt-hook marker appears. The script logs each payload to
   `~/.kommutator/spike04.log` — note the field names (`session_id`, `turn_id`, `model`).

## Record

In `../RESULTS.md`: continues / ignores / unsupported, per vendor, with versions.
