# M1 live spike runbook — Claude Code on this Mac

> Public evidence redaction: personal home paths, interface names and network addresses
> are replaced with placeholders (192.0.2.0/24 and 198.51.100.0/24 are documentation ranges).
> They are not deployment instructions or measured endpoint values. Original records are retained privately.

Run spikes 01, 04 and 06 in macOS Terminal. This supplies vendor evidence for
[MVP_PLAN step 0](../docs/MVP_PLAN.md); it does not pass the later two-session M1
acceptance run. Codex, ChatGPT desktop and Ubuntu are later work.

Initial preflight used Claude Code **2.1.280**. The completed live run on 2026-10-25 used
**2.1.310**: see [RESULTS](RESULTS.md). Manual wake, MCP identity and Stop passed; bypass
with the default inbound policy was Held even with the token. This runbook remains a
reproduction procedure, not a blanket pass. Record versions again on each run. The authorized
[bypass follow-up](01-claude-inbox-socket/BYPASS_FOLLOWUP.md) passed with explicit session-level
`accept`, including immediate half-close. The user subsequently approved that per-session
opt-in for M1 bypass sessions. Production launches also declare it with
`KOM_CLAUDE_INBOUND_POLICY=accept`; see the [plugin guide](../plugins/claude-code/README.md).
The reproduction steps below retain the default-policy control where specified.

Quick checklist:

1. [Prepare](#1-prepare-one-disposable-project): Node 24, two terminals, a fresh scratch
   directory, temporary local hooks and private credential capture.
2. [Spike 01](#2-spike-01--hook-facts-and-native-delivery): measure the hook parent;
   discover the envelope; test prompting without/with token and bypass with token;
   verify [MCP binding for two sessions in one directory](#mcp-binding-two-sessions-in-one-directory).
3. [Spike 04](#3-spike-04--stop-blocks-once-and-re-entry-is-guarded): arm one session,
   observe exactly one continuation, check `stop_hook_active`, then test unarmed.
4. [Spike 06](#4-spike-06--detached-child-survives-claude-exiting): spawn from Claude's
   Bash tool, exit Claude, wait 12 seconds and verify a fresh child heartbeat.
5. [Evidence and cleanup](#5-save-evidence-then-clean-up): fill RESULTS §§01/04/06,
   send only redacted evidence and remove this run's temporary files.

## 1. Prepare one disposable project

Use a new empty directory for the experiment, especially the bypass-mode case. Keep
the working repository out of that session. The hook commands still point to the actual
scripts in this repository. Do not load `plugins/claude-code`: its production commands
are not the spike harness.

In an ordinary terminal, first select Node 24 using your existing version manager
(`nvm use` from the repository if nvm is installed), then check:

```bash
cd /Users/REDACTED/kommutator
date -u +%FT%TZ
sw_vers
node --version
claude --version
command -v node
command -v claude
```

Keep this terminal as **Terminal A**. The following variables contain no credentials:

```bash
umask 077
export KOM_SPIKE_ROOT=/Users/REDACTED/kommutator
export KOM_SPIKE_LAB="$(mktemp -d /private/tmp/kommutator-m1.XXXXXX)"
export KOM_SPIKE_NODE="$(command -v node)"
mkdir -p "$KOM_SPIKE_LAB/.claude" "$HOME/.kommutator"
printf 'Scratch project: %s\n' "$KOM_SPIKE_LAB"
```

In **Terminal B**, select the same Node 24, set `KOM_SPIKE_ROOT` to the repository path
above and set `KOM_SPIKE_LAB` to the printed scratch path. Use `umask 077` there too.
Never run `env`, `set -x`, or print `CLAUDE_CODE_MESSAGING_TOKEN` in Claude's Bash tool.
If `~/.kommutator/spike04-fire.any` already exists, finish its owning experiment before
these runs: the existing Stop script would consume that shared flag. Do not delete it
on behalf of an unrelated session.

Create a capture hook in Terminal A. It saves only the needed session facts in a private
file, emits no output and never puts a token in a prompt or a command argument:

```bash
cat > "$KOM_SPIKE_LAB/capture.mjs" <<'JS'
import { writeFileSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input);
writeFileSync(new URL('./session.private.json', import.meta.url), JSON.stringify({
  captured_at: new Date().toISOString(),
  hook_pid: process.pid,
  hook_ppid: process.ppid,
  cwd: process.cwd(),
  session_id: payload.session_id,
  env_session_id: process.env.CLAUDE_CODE_SESSION_ID ?? null,
  permission_mode: payload.permission_mode,
  socket: process.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '',
  token: process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? ''
}), { mode: 0o600 });
JS
node --input-type=module <<'JS'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const root = process.env.KOM_SPIKE_ROOT;
const lab = process.env.KOM_SPIKE_LAB;
const file = `${lab}/.claude/settings.local.json`;
const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const additions = {
  SessionStart: [{ hooks: [
    { type: 'command', command: `${root}/spikes/01-claude-inbox-socket/ppid-probe.sh`, args: [] },
    { type: 'command', command: process.env.KOM_SPIKE_NODE, args: [`${lab}/capture.mjs`] }
  ] }],
  Stop: [{ hooks: [
    { type: 'command', command: '/bin/bash', args: [`${root}/spikes/04-stop-hook/stop-hook.sh`] }
  ] }]
};
config.hooks ??= {};
for (const [event, groups] of Object.entries(additions)) {
  config.hooks[event] ??= [];
  for (const group of groups) {
    if (!config.hooks[event].some(x => JSON.stringify(x) === JSON.stringify(group))) {
      config.hooks[event].push(group);
    }
  }
}
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
JS
```

This merges hook arrays and preserves other settings. It is intended for the newly
created scratch project. Do not copy a whole replacement settings file over an existing
project or `~/.claude/settings.json`.

`args: []` is significant: the PPID probe must be the executable Claude launches.
Wrapping it in another script or running it through the Bash tool measures a different
parent. The current [official hook reference](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form)
documents this exec form. Check `/hooks` in the new session; if the installed version
rejects the configuration, record that failure rather than silently substituting shell form.

## 2. Spike 01 — hook facts and native delivery

Start a fresh prompting-mode target from Terminal A:

```bash
cd "$KOM_SPIKE_LAB"
claude --name spike-m1-manual --permission-mode manual --setting-sources local \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools ""
```

Accept trust only for this disposable project. The command limits settings to this local
file, has no MCP servers and disables built-in tools for the message/Stop experiments.
Inspect `/hooks`, `/status` (Peer address) and `/config` (Messages from your other sessions).
Record the effective inbound setting, including “unset/default”; do not change it just
to obtain a pass. Explicit inbound policy can affect token-authenticated posts too.
[Official inbox socket documentation](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket).

Give the target one prompt:

> This is a disposable messaging experiment. For each incoming test message, answer
> in this terminal with its requested pong marker. Do not message any other session.
> Reply ready now, then wait.

Wait for the session to become idle. In Terminal B, inspect only non-secret facts:

```bash
tail -n 2 "$HOME/.kommutator/spike01-ppid.log"
stat -f '%Sp %N' "$KOM_SPIKE_LAB/session.private.json"
node --input-type=module - "$KOM_SPIKE_LAB" <<'JS'
import { readFileSync, statSync } from 'node:fs';
const s = JSON.parse(readFileSync(`${process.argv[2]}/session.private.json`, 'utf8'));
console.log({ captured_at: s.captured_at, session_id: s.session_id,
  env_session_id_present: Boolean(s.env_session_id),
  env_session_id_matches_payload: s.env_session_id ? s.env_session_id === s.session_id : null,
  permission_mode: s.permission_mode, socket_present: Boolean(s.socket),
  token_present: Boolean(s.token),
  socket_is_socket: s.socket ? statSync(s.socket).isSocket() : false });
JS
```

Require a **fresh** timestamp and a `-rw-------` private file. Record the actual probe
parent `comm`, grandparent, and variable-presence booleans. A `sh`/`bash` parent is a
finding, not confirmation that the hook PPID identifies Claude. A Bash-tool PPID is
not a substitute. If credentials are missing, record that before posting; do not guess
another session's socket or use an old capture.
Record the payload's actual `session_id` and whether `CLAUDE_CODE_SESSION_ID` is present and
matches, including absence or mismatch. This hook observation does not establish what
the real stdio MCP process receives. Run the separate two-session MCP experiment below;
a Bash-tool environment dump cannot confirm that binding.

The 2.1.310 run verified `{"type":"user","message":{"role":"user","content":"…"}}`.
For another version, recheck the envelope. The discovery script currently fails with
BSD grep (`.{0,400}` exceeds its repetition limit); that is a known script issue, not a
protocol failure. Its command is:

```bash
cd "$KOM_SPIKE_ROOT"
bash spikes/01-claude-inbox-socket/discover-format.sh \
  > "$KOM_SPIKE_LAB/format-discovery.txt" 2>&1
printf 'Discovery exit code: %s\n' "$?"
less "$KOM_SPIKE_LAB/format-discovery.txt"
```

Inspect the fields around the message parser. A candidate is unconfirmed until a live
post works. The discovery script uses `pipefail` with `head`; exit 141 can be a truncated
pipeline, so inspect the captured output and report the code. Do not conclude that the
installed CLI has no socket protocol from that exit alone.

Create this terminal-only wrapper. It runs the existing `post.mjs` in the same process,
so the token never appears in OS command-line arguments. It buffers and redacts output
before printing, including any echoed token in the reply. Its 12-second observation cap
also bounds a peer that does not close after `post.mjs` half-closes at eight seconds.

```bash
cat > "$KOM_SPIKE_LAB/post-private.mjs" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const s = JSON.parse(readFileSync(new URL('./session.private.json', import.meta.url), 'utf8'));
const [mode, ...args] = process.argv.slice(2);
if (!['no-token', 'with-token'].includes(mode) || !s.socket || (mode === 'with-token' && !s.token)) {
  throw new Error('Missing session facts or invalid mode; recapture the target session');
}
const originalWrite = process.stdout.write.bind(process.stdout);
let output = '';
const collect = (chunk, encoding, callback) => {
  output += String(chunk);
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};
process.stdout.write = collect;
process.stderr.write = collect;
process.on('exit', () => {
  let safe = output;
  if (s.token) safe = safe.split(s.token).join('<TOKEN>');
  safe = safe.replace(/"token"\s*:\s*"[^"]*"/g, '"token":"<TOKEN>"');
  originalWrite(safe);
});
const script = `${process.env.KOM_SPIKE_ROOT}/spikes/01-claude-inbox-socket/post.mjs`;
process.argv = [process.execPath, script, '--socket', s.socket, ...args];
if (mode === 'with-token') process.argv.push('--token', s.token);
setTimeout(() => { console.error('Observation ended at 12 seconds'); process.exit(124); }, 12000).unref();
await import(pathToFileURL(script).href);
JS
```

If the discovered envelope matches candidate 1 (`type`, `from`, `text`), try:

```bash
date -u +%FT%TZ
node "$KOM_SPIKE_LAB/post-private.mjs" no-token --shape 1 \
  --text 'spike01-A: reply here with pong-A; do not use tools'
```

Otherwise put the discovered JSON envelope into `$KOM_SPIKE_LAB/payload.json`, with
the same harmless request and a unique marker in its actual message field, then use:

```bash
node "$KOM_SPIKE_LAB/post-private.mjs" no-token \
  --raw "$(cat "$KOM_SPIKE_LAB/payload.json")"
```

Use the **working envelope** for all remaining cases. For candidate 1, the next call is:

```bash
node "$KOM_SPIKE_LAB/post-private.mjs" with-token --shape 1 \
  --text 'spike01-B: reply here with pong-B; do not use tools'
```

For a custom envelope, edit the marker in `payload.json` and use `with-token --raw`.
`--text` does not change the body when `--raw` is present. Use unique bodies, send one
message at a time, and wait for idle before the next test.

Record each row separately:

| Target mode | Auth | Marker | Required observations |
| --- | --- | --- | --- |
| manual/prompting | none | A | socket reply, Delivered/Held/Refused, idle turn starts, pong-A |
| manual/prompting | token | B | same observations, pong-B |
| bypassPermissions | token | C | same observations, pong-C |
| bypassPermissions | none | D | optional control; record actual outcome, do not approve a held message |

For C, `/exit` the manual target, remove its capture in Terminal B, then start a new
target from the **same disposable scratch directory** in Terminal A:

```bash
# Terminal B, only after the previous target exited:
rm "$KOM_SPIKE_LAB/session.private.json"
```

```bash
# Terminal A, only in the disposable scratch directory:
cd "$KOM_SPIKE_LAB"
claude --name spike-m1-bypass --dangerously-skip-permissions --setting-sources local \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools ""
```

Repeat the hook/capture checks and the initial “ready” prompt; wait for idle. Send C
with `with-token` and the confirmed envelope. Do not reuse the previous session's
credentials. If trying optional D, run it last and dismiss any approval dialog after
recording Held. Do not enable bypass mode in the working repository.

Record send time, first visible message time, turn-start time and pong time, approximately
if necessary. Observe for up to 30 seconds without typing another prompt. Capture the
exact message JSON and socket reply, with secrets removed. Distinguish these outcomes:

- A write, connection close, exit 0 or ACK alone is transport evidence.
- A new idle-session turn and the matching pong in the target terminal are wake evidence.
- A later user-approved or user-prompted reply is not an automatic wake pass.
- No visible result is “unclassified/no visible delivery” unless a reply explicitly
  establishes Refused; wrong envelope, refusal and missing UI evidence differ.

The socket reply is not necessarily the model's pong. Keep its meaning unknown unless
the observations establish it means shown/turn started rather than queued. This spike
does not prove a kommutator thread reply; that remains MVP_PLAN step 6.

### MCP binding: two sessions in one directory

This is a required part of spike 01. Use the existing
[env-probe-mcp.mjs](01-claude-inbox-socket/env-probe-mcp.mjs) as an actual stdio MCP server.
It records its PID, PPID, cwd, selected environment facts and `initialize` requests in
`~/.kommutator/spike01-mcp-env.log`. Do not run it through Claude's Bash tool.

Exit the earlier targets. Keep Terminal B as observer and open **Terminal C** for the
second target. In Terminal C, select Node 24, set `KOM_SPIKE_LAB` to the same scratch
path and run `umask 077`. Both targets must stay open in that exact directory.

In Terminal B, create a temporary MCP configuration and record where this run's log
starts. This does not change `.mcp.json` or any saved MCP configuration:

```bash
rm -f "$KOM_SPIKE_LAB/session.private.json"
node --input-type=module - "$KOM_SPIKE_LAB" "$KOM_SPIKE_ROOT" <<'JS'
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const [lab, root] = process.argv.slice(2);
const log = `${homedir()}/.kommutator/spike01-mcp-env.log`;
writeFileSync(`${lab}/mcp-probe.json`, JSON.stringify({ mcpServers: {
  'spike01-env': { command: process.execPath,
    args: [`${root}/spikes/01-claude-inbox-socket/env-probe-mcp.mjs`] }
} }, null, 2), { flag: 'wx', mode: 0o600 });
writeFileSync(`${lab}/mcp-observation.json`, JSON.stringify({
  started_at: new Date().toISOString(), offset: existsSync(log) ? statSync(log).size : 0
}), { flag: 'wx', mode: 0o600 });
JS
```

Start A in Terminal A:

```bash
cd "$KOM_SPIKE_LAB"
claude --name spike-mcp-a --permission-mode manual --setting-sources local \
  --strict-mcp-config --mcp-config "$KOM_SPIKE_LAB/mcp-probe.json" --tools ""
```

Check `/hooks` and `/mcp`; approve this temporary local server if Claude asks. Wait until
`spike01-env` is connected. Before starting B, save A's fresh hook capture in Terminal B:

```bash
node --input-type=module - "$KOM_SPIKE_LAB" a <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const [lab, label] = process.argv.slice(2);
const s = JSON.parse(readFileSync(`${lab}/session.private.json`, 'utf8'));
const run = JSON.parse(readFileSync(`${lab}/mcp-observation.json`, 'utf8'));
if (!s.session_id || s.captured_at < run.started_at) throw new Error('Fresh hook capture missing');
writeFileSync(`${lab}/mcp-${label}.private.json`, JSON.stringify(s), { flag: 'wx', mode: 0o600 });
console.log({ label, captured_at: s.captured_at, session_id: s.session_id,
  hook_pid: s.hook_pid, hook_ppid: s.hook_ppid, cwd: s.cwd });
JS
rm "$KOM_SPIKE_LAB/session.private.json"
```

The latest capture is overwritten by each SessionStart. Preserve the per-session copies;
do not `/clear`, resume or restart either target during this measurement. Keep A open.
Start B in Terminal C:

```bash
cd "$KOM_SPIKE_LAB"
claude --name spike-mcp-b --permission-mode manual --setting-sources local \
  --strict-mcp-config --mcp-config "$KOM_SPIKE_LAB/mcp-probe.json" --tools ""
```

Check B's `/hooks` and `/mcp` too. In Terminal B, save B before doing anything else:

```bash
node --input-type=module - "$KOM_SPIKE_LAB" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const lab = process.argv[2];
const a = JSON.parse(readFileSync(`${lab}/mcp-a.private.json`, 'utf8'));
const b = JSON.parse(readFileSync(`${lab}/session.private.json`, 'utf8'));
if (!b.session_id || b.session_id === a.session_id || b.captured_at < a.captured_at) {
  throw new Error('Distinct, fresh B hook capture missing');
}
writeFileSync(`${lab}/mcp-b.private.json`, JSON.stringify(b), { flag: 'wx', mode: 0o600 });
console.log({ label: 'b', captured_at: b.captured_at, session_id: b.session_id,
  hook_pid: b.hook_pid, hook_ppid: b.hook_ppid, cwd: b.cwd });
JS
```

Compare only non-secret facts from both captures and this run's MCP log. This command
prints no captured socket or token, and never prints the complete environment:

```bash
node --input-type=module - "$KOM_SPIKE_LAB" <<'JS'
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const lab = process.argv[2];
const run = JSON.parse(readFileSync(`${lab}/mcp-observation.json`, 'utf8'));
const hooks = ['a', 'b'].map(label => ({ label,
  ...JSON.parse(readFileSync(`${lab}/mcp-${label}.private.json`, 'utf8')) }));
const lines = readFileSync(`${homedir()}/.kommutator/spike01-mcp-env.log`)
  .subarray(run.offset).toString('utf8').trim().split('\n');
const servers = lines.flatMap(line => {
  const m = line.match(/^(\S+) pid=(\d+) ppid=(\d+) cwd=(.*?) env=(\{.*\})$/);
  if (!m || !hooks.some(h => h.cwd === m[4])) return [];
  const env = JSON.parse(m[5]);
  return [{ started_at: m[1], pid: Number(m[2]), ppid: Number(m[3]), cwd: m[4],
    session_ids: Object.fromEntries(Object.entries(env).filter(([name]) =>
      /SESSION_ID/i.test(name) && !/TOKEN|KEY|SECRET/i.test(name))),
    initialized: lines.some(l => l.includes(` pid=${m[2]} initialize clientInfo=`)) }];
});
console.log(JSON.stringify({ servers, hooks: hooks.map(h => ({
  label: h.label, session_id: h.session_id, hook_pid: h.hook_pid,
  hook_ppid: h.hook_ppid, cwd: h.cwd,
  id_matches: servers.flatMap(s => Object.entries(s.session_ids)
    .filter(([, value]) => value === h.session_id)
    .map(([variable]) => ({ pid: s.pid, variable, initialized: s.initialized }))),
  parent_matches: servers.filter(s => s.ppid === h.hook_ppid).map(s => s.pid)
})) }, null, 2));
const pids = [...new Set([...servers.map(s => s.pid), ...hooks.map(h => h.hook_ppid)])]
  .filter(p => Number.isInteger(p) && p > 0);
if (pids.length) spawnSync('ps', ['-o', 'pid,ppid,comm', '-p', pids.join(',')], { stdio: 'inherit' });
JS
```

Record **both rows**: hook `session_id`, actual matching MCP variable name (if any), MCP
PID/PPID, whether `initialize` was logged, and whether both server PIDs are alive while
both Claude sessions are open. Compare each capture hook's PPID with its contemporaneous
`ppid-probe.sh` log line and the process names; do not assume either is Claude.

The desired observation is two distinct initialized MCP processes in the same cwd, each
exposing its own hook's session ID. `CLAUDE_CODE_SESSION_ID` is a hypothesis until both rows
show it. Record missing/mismatched IDs, shared processes, extra starts or initialization
failures as observed. When no ID matches, record the parent relationships for the planned
fallback; a shared cwd or a Bash environment value does not prove binding. `/mcp` showing
connected without the process/identity evidence is insufficient.

Exit A and B before proceeding. This probe checks MCP identity and initialization only;
it does not spawn a detached child and does not pass the MCP lifecycle part of spike 06.

## 3. Spike 04 — Stop blocks once and re-entry is guarded

Exit the earlier targets and start a fresh **manual** target with the command from section 2.
After a simple `Reply hi, without tools` prompt completes, use Terminal B to arm only
the captured target session (never the shared `.any` flag):

```bash
node --input-type=module - "$KOM_SPIKE_LAB" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const s = JSON.parse(readFileSync(`${process.argv[2]}/session.private.json`, 'utf8'));
if (!/^[A-Za-z0-9._-]+$/.test(s.session_id ?? '')) throw new Error('Invalid session id');
writeFileSync(`${homedir()}/.kommutator/spike04-fire.${s.session_id}`, '', { flag: 'wx', mode: 0o600 });
writeFileSync(`${process.argv[2]}/armed-session.txt`, s.session_id, { mode: 0o600 });
console.log(`Armed Stop for session ${s.session_id}`);
JS
```

Prompt `Reply hi, without tools` again. Expect the normal reply, exactly one additional
continuation with `pong`, then idle. Inspect `~/.kommutator/spike04.log` locally for this
session and run: one `fired for session ...` line and the re-entry payload containing
`stop_hook_active: true`. Send another unarmed trivial prompt: it must stop normally.
Record counts, payload field names and unexpected continuations. The log contains full
hook payloads, so share only selected, redacted lines. This tests vendor Stop semantics,
not the daemon's future DND/FYI/hop filtering.

## 4. Spike 06 — detached child survives Claude exiting

Use a fresh manual session in the scratch project, with Bash enabled:

```bash
cd "$KOM_SPIKE_LAB"
claude --name spike-m1-detached --permission-mode manual --setting-sources local \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools Bash
```

Ensure no earlier spike06 child is still running before starting another: the existing
script reuses `~/.kommutator/spike06.pid`. Ask this session exactly:

> With the Bash tool, run
> `node /Users/REDACTED/kommutator/spikes/06-detached-spawn/parent.mjs`
> once and report its output. Do not run any other command or send any messages.

Approve that command in the manual session. Record the returned child PID. Exit Claude
with `/exit`; record that time. From Terminal B, wait long enough to exclude a heartbeat
written before exit, then run the existing check:

```bash
sleep 12
date -u +%FT%TZ
bash "$KOM_SPIKE_ROOT/spikes/06-detached-spawn/check.sh"
printf 'Check exit code: %s\n' "$?"
```

Pass evidence is exit 0 plus a fresh heartbeat for that **same child PID after Claude
exited**. `kill -0` alone does not suffice. The child expires after about ten minutes.
To stop it earlier, first confirm `ps -o pid,ppid,command -p CHILD_PID` identifies this
run's `spikes/06-detached-spawn/child.mjs`, then `kill CHILD_PID`; do not kill an unchecked
PID from a stale file.

Record this as **Bash-tool descendant survived**, not “MCP survival passed”. Once the
real stdio MCP shim exists, repeat the spawn from that process and exit its Claude
parent. Also verify two shims attach to one daemon and that it survives the first
session exiting. Those are later agentd/MCP checks, not completed by this proxy.

## 5. Save evidence, then clean up

Fill [RESULTS.md](RESULTS.md) §§01/04/06 with the run date, macOS/Node/Claude versions,
launch flags and these observations. Leave Codex/Ubuntu and M1 E2E untested. Send back:

1. Exec-form hook parent/grandparent, observed hook payload/environment identity facts,
   and socket/token presence, never their secret values. Include the two-session MCP
   comparison: hook IDs, matching variable names or absence, distinct PID/PPID evidence,
   initialization and simultaneous liveness. Mark unrun binding checks unverified.
2. Working message JSON with harmless markers; socket replies with tokens redacted.
3. The three required permission/auth rows, effective inbound setting, idle wake/pong
   outcomes and timings; optional no-token bypass result separately.
4. Stop continuation count, `stop_hook_active` re-entry evidence, unarmed follow-up outcome.
5. Detached child's PID, exit/check times, exact `check.sh` result, and the Bash/MCP caveat.
6. Any command failure or absent variable, without replacing it with an expected result.

Exit all experimental Claude sessions before cleanup. Remove any still-armed flag only
for the session armed by this run. Remove these exact scratch files; retain or review
discovery output and any manually saved evidence first:

```bash
node --input-type=module - "$KOM_SPIKE_LAB" <<'JS'
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
const marker = `${process.argv[2]}/armed-session.txt`;
if (existsSync(marker)) {
  const sid = readFileSync(marker, 'utf8');
  if (!/^[A-Za-z0-9._-]+$/.test(sid)) throw new Error('Invalid session id');
  rmSync(`${homedir()}/.kommutator/spike04-fire.${sid}`, { force: true });
  rmSync(marker);
}
JS
rm -f "$KOM_SPIKE_LAB/session.private.json" "$KOM_SPIKE_LAB/capture.mjs" \
  "$KOM_SPIKE_LAB/post-private.mjs" "$KOM_SPIKE_LAB/payload.json" \
  "$KOM_SPIKE_LAB/mcp-a.private.json" "$KOM_SPIKE_LAB/mcp-b.private.json" \
  "$KOM_SPIKE_LAB/mcp-probe.json" "$KOM_SPIKE_LAB/mcp-observation.json" \
  "$KOM_SPIKE_LAB/.claude/settings.local.json"
rmdir "$KOM_SPIKE_LAB/.claude"
```

Delete `format-discovery.txt` after saving the needed envelope, then `rmdir "$KOM_SPIKE_LAB"`;
if the directory is nonempty, inspect it rather than recursively deleting it. The logs
under `~/.kommutator` may contain older experiments: do not erase them wholesale. No
global hook settings were changed by this procedure.
