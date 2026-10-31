// Synthetic hooks and MCP clients verify packaging/lifecycle; this is not vendor wake evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubServer } from '../packages/hub/dist/server.js';
import { openDatabase } from '../packages/hub/dist/db.js';
const artifact = resolve(process.argv[2]);
const home = await mkdtemp(join(tmpdir(), 'kom-export-e2e-'));
const project = join(home, 'project');
const kom = join(home, 'kom');
await mkdir(project); await mkdir(kom); await mkdir(join(home, 'os-bin')); await symlink('/bin/ps', join(home, 'os-bin/ps'));
const db = openDatabase(':memory:');
const hub = createHubServer({ db, key: 'synthetic-plugin-e2e-key' });
// A restart's IPC listener precedes its first hub handshake; exercise that boundary deterministically.
const upgrades = hub.listeners('upgrade'); hub.removeAllListeners('upgrade'); let upgradeCount = 0;
const hubSockets = new Set(); let offline = false;
hub.on('connection', socket => { hubSockets.add(socket); socket.once('close', () => hubSockets.delete(socket)); });
hub.on('upgrade', (...args) => { if (offline) { args[1].destroy(); return; } const delay = upgradeCount++ > 0 ? 200 : 0; setTimeout(() => { for (const handle of upgrades) handle(...args); }, delay); });
await new Promise(resolve => hub.listen(0, '127.0.0.1', resolve));
// Include the settings written by a real marketplace install, not just an empty vendor home.
const claudeSettings = join(home, '.claude/settings.json');
const codexSettings = join(home, 'codex/config.toml');
const installedClaude = {
  extraKnownMarketplaces: { kommutator: { source: { source: 'github', repo: 'alex-voloshin-dev/kommutator' } } },
  enabledPlugins: { 'kommutator@kommutator': true },
};
const installedCodex = '[plugins."kommutator@kommutator"]\nenabled = true\n';
await mkdir(join(home, '.claude')); await mkdir(join(home, 'codex'));
await writeFile(claudeSettings, JSON.stringify(installedClaude));
await writeFile(codexSettings, installedCodex);
const clients = [];
const moved = [];
const env = { HOME: home, KOM_HOME: kom, CODEX_HOME: join(home, 'codex'), PATH: join(home, 'os-bin') };
function owner(id) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/plugin-owner.mjs', import.meta.url)), join(artifact, 'plugins/claude-code')], {
    cwd: '/', env: { ...env, CLAUDE_CODE_SESSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  clients.push(child);
  let serial = 0;
  const pending = new Map();
  child.on('message', reply => pending.get(reply.id)?.(reply));
  return { child, command(action, payload = {}) {
    const requestId = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Owner fixture timeout: ${action}`)); }, 15000);
      pending.set(requestId, reply => { clearTimeout(timer); pending.delete(requestId); reply.error ? reject(new Error(reply.error)) : resolve(); });
      child.send({ id: requestId, action, ...payload });
    });
  } };
}
async function hook(vendor, id, event = 'SessionStart', cwd = project, parent) {
  if (parent) return parent.command('hook', { event, payload: { session_id: id, cwd, permission_mode: 'default' } });
  const child = spawn(join(artifact, 'plugins', vendor, 'bin/hook'), [event], { cwd: '/', env: { ...env, CLAUDE_CODE_SESSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.resume();
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0); assert.equal(stdout, ''); resolve(); } catch (error) { reject(error); } }); });
  child.stdin.end(JSON.stringify({ session_id: id, cwd, permission_mode: 'default' }));
  await done;
}
async function client(vendor, id, parent) {
  const child = parent?.child ?? spawn(join(artifact, 'plugins', vendor, 'bin/mcp'), [], { cwd: '/', env: { ...env, CLAUDE_CODE_SESSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe'] });
  if (!parent) clients.push(child);
  let buffer = ''; let serial = 0; const pending = new Map();
  child.stderr.resume();
  child.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); pending.get(reply.id)?.(reply); } });
  async function request(method, params) {
    const requestId = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout ${vendor} ${method}`)); }, 15000);
      pending.set(requestId, reply => { clearTimeout(timer); pending.delete(requestId); reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply.result); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  if (parent) await parent.command('start');
  await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: vendor, version: 'fixture' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return { child, async call(name, args = {}, root = id, expectedError = false) {
    const reply = await request('tools/call', { name, arguments: args, _meta: { sessionId: root, threadId: root } });
    assert.equal(Boolean(reply.isError), expectedError, `${vendor} ${name}: ${reply.content?.[0]?.text}`);
    return expectedError ? reply.content[0].text : JSON.parse(reply.content[0].text);
  } };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise(resolve => child.once('close', resolve)); child.kill('SIGTERM'); await done;
}
try {
  const setup = await client('claude-code', 'setup-root');
  assert.equal((await setup.call('setup_status')).configured, false);
  const form = new URL((await setup.call('setup_start')).url);
  const response = await fetch(form, {
    method: 'POST', headers: { Origin: form.origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: form.pathname.slice(1), hub: `http://127.0.0.1:${hub.address().port}`, host: 'fixture', key: 'synthetic-plugin-e2e-key' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await setup.call('setup_status')).configured, true);
  await stop(setup.child);
  // These hooks execute before any daemon exists. First whoami must work without a second hook.
  const firstOwner = owner('claude-root-a');
  const secondOwner = owner('claude-root-a');
  assert.notEqual(firstOwner.child.pid, secondOwner.child.pid);
  await hook('claude-code', 'claude-root-a', 'SessionStart', project, firstOwner);
  await hook('claude-code', 'claude-root-a', 'SessionStart', project, secondOwner);
  const claude = await client('claude-code', 'claude-root-a', firstOwner);
  const author = (await claude.call('whoami')).session;
  assert.equal(author.vendor_session_id, 'claude-root-a'); assert.equal(author.cwd, project);
  const otherClaude = await client('claude-code', 'claude-root-a', secondOwner);
  const otherAuthor = (await otherClaude.call('whoami')).session;
  assert.equal(otherAuthor.vendor_session_id, author.vendor_session_id);
  assert.equal(otherAuthor.cwd, author.cwd);
  assert.notEqual(otherAuthor.id, author.id, 'Concurrent Claude processes sharing a vendor ID need separate hub identities');
  assert.notEqual(otherAuthor.handle, author.handle);
  for (let turn = 0; turn < 3; turn++) {
    await claude.call('set_status', { status_line: `first-${turn}`, role: 'author' });
    await otherClaude.call('set_status', { status_line: `second-${turn}`, role: 'reviewer' });
    for (const [c, original, status, role] of [[claude, author, `first-${turn}`, 'author'], [otherClaude, otherAuthor, `second-${turn}`, 'reviewer']]) {
      const current = (await c.call('whoami')).session;
      assert.equal(current.id, original.id); assert.equal(current.handle, original.handle);
      assert.equal(current.incarnation, original.incarnation, 'Alternating clients must not reincarnate one another');
      assert.equal(current.status_line, status); assert.equal(current.role, role);
    }
  }
  const toSecond = await claude.call('send', { to: otherAuthor.handle, body: 'only second owner' });
  const toFirst = await otherClaude.call('send', { to: author.handle, body: 'only first owner' });
  const firstInbox = (await claude.call('inbox')).headers.map(header => header.id);
  const secondInbox = (await otherClaude.call('inbox')).headers.map(header => header.id);
  assert(firstInbox.includes(toFirst.id)); assert(!firstInbox.includes(toSecond.id));
  assert(secondInbox.includes(toSecond.id)); assert(!secondInbox.includes(toFirst.id));
  assert.equal((await claude.call('read', { id: toFirst.id })).message.body, 'only first owner');
  assert.equal((await otherClaude.call('read', { id: toSecond.id })).message.body, 'only second owner');
  // Cross the daemon's default 20-second sweep with live owners and no native endpoint.
  // Do not run hooks here: they could revive incorrectly ended hook-only sessions.
  await new Promise(resolve => setTimeout(resolve, 21000));
  for (const [c, original, status] of [[claude, author, 'first-2'], [otherClaude, otherAuthor, 'second-2']]) {
    const current = (await c.call('whoami')).session;
    assert.equal(current.id, original.id, 'A live hook-only owner must survive the daemon sweep');
    assert.equal(current.incarnation, original.incarnation, 'A sweep must not force hook-only re-registration');
    assert.equal(current.status_line, status); assert.notEqual(current.state, 'gone');
  }
  await hook('claude-code', 'claude-root-a', 'SessionEnd', project, secondOwner);
  assert((await claude.call('list_sessions', { state: 'gone' })).sessions.some(session => session.id === otherAuthor.id), 'SessionEnd must end its own owner');
  await hook('claude-code', 'claude-root-a', 'SessionStart', project, firstOwner);
  const survivor = (await claude.call('whoami')).session;
  assert.equal(survivor.id, author.id); assert.equal(survivor.incarnation, author.incarnation);
  assert.equal(survivor.status_line, 'first-2'); assert.notEqual(survivor.state, 'gone');
  await otherClaude.call('whoami', {}, 'claude-root-a', true);
  assert.equal((await claude.call('whoami')).session.id, author.id);
  await stop(otherClaude.child);
  console.log('PASS: synthetic Claude owners with real process ancestry sharing vendor ID/cwd retain separate identities, statuses and inboxes; SessionEnd preserves the other owner');
  await hook('codex', 'codex-root-a'); await hook('codex', 'codex-root-b');
  const codex = await client('codex', 'codex-root-a');
  const [a, b] = await Promise.all(['codex-root-a', 'codex-root-b'].map(async root => (await codex.call('whoami', {}, root)).session));
  assert.equal(a.cwd, project); assert.equal(b.cwd, project); assert.notEqual(a.id, b.id); assert.notEqual(a.id, author.id);
  await hook('codex', 'codex-root-a', 'SessionStart', '/child/overwrite-attempt');
  assert.equal((await codex.call('whoami')).session.cwd, project);
  const sent = await claude.call('send', { to: a.handle, body: 'cross-vendor message' });
  assert.equal(sent.status, 'sent');
  const inbox = await codex.call('inbox'); assert(inbox.headers.some(header => header.id === sent.id));
  const read = await codex.call('read', { id: sent.id }); assert.equal(read.message.body, 'cross-vendor message'); assert.equal(read.state, 'read');
  const reply = await codex.call('send', { to: author.handle, body: 'reply', reply_to: sent.id });
  assert.equal((await claude.call('read', { id: reply.id })).message.body, 'reply');
  for (const c of [claude, codex]) await c.call('join_topic', { name: 'qa-room' });
  await claude.call('board_put', { topic: 'qa-room', key: 'handoff', body: 'ready' });
  assert.equal((await codex.call('board_get', { topic: 'qa-room' })).entries[0].body, 'ready');
  const topic = await claude.call('send', { to: 'topic:qa-room', kind: 'topic', body: 'topic message' });
  assert.equal((await codex.call('read', { id: topic.id })).message.body, 'topic message');
  // Installed metadata must coexist with normal calls, but real manual integrations still block.
  await writeFile(claudeSettings, JSON.stringify({ ...installedClaude, mcpServers: { kommutator: { command: 'kom', args: ['mcp'] } } }));
  assert.match(await claude.call('whoami', {}, 'claude-root-a', true), /Duplicate legacy kommutator integration/);
  await writeFile(claudeSettings, JSON.stringify(installedClaude));
  assert.equal((await claude.call('whoami')).session.id, author.id);
  await writeFile(codexSettings, installedCodex + '\n[mcp_servers.kommutator]\ncommand = "kom"\nargs = ["mcp"]\n');
  assert.match(await codex.call('whoami', {}, 'codex-root-a', true), /Duplicate legacy kommutator integration/);
  await writeFile(codexSettings, installedCodex);
  assert.equal((await codex.call('whoami')).session.id, a.id);
  console.log('PASS: marketplace metadata survives private setup, fresh hooks, whoami and messaging; actual legacy MCP entries still block');
  const before = JSON.parse(await readFile(join(kom, 'agentd.json'), 'utf8'));
  const release = JSON.parse(await readFile(join(artifact, 'plugins/codex/runtime/release.json'), 'utf8'));
  assert.equal(before.version, release.version);
  // Both ongoing clients and daemon must live outside the disposable vendor cache.
  for (const vendor of ['claude-code', 'codex']) { const path = join(artifact, 'plugins', vendor, 'runtime'); await rename(path, path + '.qa-hidden'); moved.push(path); }
  await stop(claude.child);
  assert.equal((await codex.call('whoami')).session.id, a.id);
  assert.equal(JSON.parse(await readFile(join(kom, 'agentd.json'), 'utf8')).pid, before.pid);
  process.kill(before.pid, 'SIGTERM');
  for (let i = 0; i < 100; i++) { try { process.kill(before.pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.throws(() => process.kill(before.pid, 0), { code: 'ESRCH' });
  await assert.rejects(stat(join(kom, 'agentd.sock')), { code: 'ENOENT' });
  assert.equal((await codex.call('whoami')).session.id, a.id);
  assert.notEqual(JSON.parse(await readFile(join(kom, 'agentd.json'), 'utf8')).pid, before.pid);
  offline = true;
  for (const socket of hubSockets) socket.destroy();
  const queued = await codex.call('send', { to: b.handle, body: 'queued through real hub outage' });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.outbox_depth, 1);
  console.log('PASS: offline send remains queued after bounded readiness wait');
  console.log('PASS: exported cold Claude, concurrent same-cwd Codex roots, immutable context, cross-vendor send/read/reply/topic/board, cache deletion, shared daemon survivor and restart (synthetic fixtures only)');
} finally {
  for (const path of moved) await rename(path + '.qa-hidden', path);
  for (const child of clients) await stop(child);
  try { const { pid } = JSON.parse(await readFile(join(kom, 'agentd.json'), 'utf8')); process.kill(pid, 'SIGTERM'); for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 25)); } } catch {}
  await new Promise(resolve => hub.close(resolve)); db.close(); await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
