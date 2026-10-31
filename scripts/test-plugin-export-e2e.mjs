// Synthetic hooks and MCP clients verify packaging/lifecycle; this is not vendor wake evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
async function hook(vendor, id, event = 'SessionStart', cwd = project) {
  const child = spawn(join(artifact, 'plugins', vendor, 'bin/hook'), [event], { cwd: '/', env: { ...env, CLAUDE_CODE_SESSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.resume();
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0); assert.equal(stdout, ''); resolve(); } catch (error) { reject(error); } }); });
  child.stdin.end(JSON.stringify({ session_id: id, cwd, permission_mode: 'default' }));
  await done;
}
async function client(vendor, id) {
  const child = spawn(join(artifact, 'plugins', vendor, 'bin/mcp'), [], { cwd: '/', env: { ...env, CLAUDE_CODE_SESSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe'] });
  clients.push(child);
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
  await hook('claude-code', 'claude-root-a');
  const claude = await client('claude-code', 'claude-root-a');
  const author = (await claude.call('whoami')).session;
  assert.equal(author.vendor_session_id, 'claude-root-a'); assert.equal(author.cwd, project);
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
