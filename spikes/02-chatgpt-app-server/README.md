# Spike 02 — drive the ChatGPT desktop app's Codex app-server

**Question.** Does the ChatGPT desktop app (which runs the Codex engine) expose the
app-server over a local unix socket, and can an outside process list threads and start a
turn in an existing thread — i.e. wake it?

**Known from the docs** (`learn.chatgpt.com/codex/app-server`):

- Transports: stdio (JSONL), WebSocket (`ws://`), and **unix socket** = WebSocket over the
  standard HTTP upgrade on "Codex's default app-server control socket" (path not documented).
- Handshake: `{"method":"initialize","id":0,"params":{"clientInfo":{"name":"…","title":"…","version":"…"}}}`
  then the notification `{"method":"initialized","params":{}}`.
- `thread/list` → `{ data: [{ id, preview, name, status, … }], nextCursor }`.
- `turn/start` → `{ threadId, input: [{ type: "text", text }] }`; `turn/steer` adds `expectedTurnId`.
- Notifications have no `id`: `{"method":"turn/started","params":{…}}`.

## Steps

```bash
npm install            # pulls `ws`, which speaks ws+unix://
./find-socket.sh       # lists socket candidates while the ChatGPT app is running
```

1. Open the ChatGPT desktop app, create (or open) a Work thread in some folder and leave it idle.
2. Run `./find-socket.sh`. It uses `lsof -U` on the app's processes and searches the usual
   directories. Export the winner: `export SOCK=/path/to.sock`.
3. List threads: `node client.mjs list` (uses `$SOCK`, or `--socket`). Note the thread id of
   the one you opened.
4. Wake it: `node client.mjs start --thread thr_… --text "Say 'pong' and nothing else."`.
   The client prints every notification and waits for the terminal event of *that* turn.
   An event counts only if it names both the expected thread **and** the expected turn id;
   events that omit either are printed but ignored, so if the app's terminal events carry
   no turn id the run ends in a timeout — note that in `RESULTS.md` rather than loosening
   the matcher. PASS requires `turn/completed` **with `turn.status === "completed"`**;
   `failed`, `interrupted`, a missing or unknown status all fail. Exit codes: 0 completed,
   2 failed/interrupted/unknown, 3 timeout (request accepted, outcome unknown). Watch the
   app as well: an accepted request is not yet a wake.
5. While a turn is running, try `node client.mjs steer --thread thr_… --turn turn_… --text "Also say the time."`.
6. Per-thread vs per-app MCP: configure any stdio MCP server in `~/.codex/config.toml` if
   none is (e.g. `codex mcp add echo -- npx -y @modelcontextprotocol/server-everything`),
   open two threads, then `ps aux | grep -i server-everything` — one process or two? Record
   it; it decides how `whoami` resolves the calling thread.

Field names in `client.mjs` (`thread/list` with `sortKey`, `turn/start` input items) come
from the app-server reference examples; if the running version rejects them, paste the
error into `RESULTS.md`.

**No socket found?** The protocol can still be exercised against a fresh engine:
`node client.mjs --stdio list` spawns `codex app-server` over stdio. That proves the client,
not the wake path. Record both outcomes.

## Pass criterion

`turn/start` on an existing, idle thread of the running desktop app makes it process the
turn. If only stdio works, the Codex adapter stays in hook mode for the MVP.
