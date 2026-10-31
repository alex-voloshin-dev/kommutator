# Spikes (M0)

Throwaway experiments that de-risk `docs/DESIGN.md` before any real code. Each folder has
its own README with steps and a pass criterion. Record what you find in `RESULTS.md` next
to this file — the adapters are written from those notes.

Run these **in a terminal on the Mac itself**, not inside a Cowork/VM shell: they need the
real Claude Code sessions, the ChatGPT desktop app and `/tmp` of the host.

| # | Folder | Question | Design impact |
|---|---|---|---|
| 01 | `01-claude-inbox-socket` | What is the message line format on a Claude Code inbox socket, and is a token-authenticated post *Delivered* in both permission modes? | Claude adapter: `native` vs `hook` |
| 02 | `02-chatgpt-app-server` | Does the ChatGPT desktop app expose the Codex app-server socket, and can we `turn/start` an existing thread? | Codex adapter: `native` vs `hook` |
| 04 | `04-stop-hook` | Does a `Stop` hook returning `decision: block` make the agent continue with the reason? Claude Code and Codex. | Stop-time poll |
| 06 | `06-detached-spawn` | Does a daemon spawned from inside an agent session survive the agent exiting? | Lazy start |

Spikes 03 (Codex TUI socket) and 05 (Windows) are deferred with Windows support.

Requirements: Node 24 on PATH, Claude Code ≥ 2.1.228, ChatGPT desktop app signed in
(spike 02), Codex CLI (optional, for the stdio fallback in 02 and for 04).
