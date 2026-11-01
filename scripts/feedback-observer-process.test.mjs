import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHubServer } from '../packages/hub/dist/server.js';
import { openDatabase } from '../packages/hub/dist/db.js';
import { HubLink } from '../packages/agentd/dist/index.js';

const entry = fileURLToPath(new URL('./feedback-observer.mjs', import.meta.url));
const topic = 'kommutator feedback';
const key = 'synthetic-process-fixture-key-not-a-real-credential';
async function eventually(check, description, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await delay(40); } while (Date.now() < deadline);
  assert.fail(`Timed out: ${description}`);
}
async function contents(path) { try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } }
async function running(pid) {
  try {
    const status = await readFile(`/proc/${pid}/stat`, 'utf8');
    // A reaped-or-zombie descendant cannot execute; containers may defer orphan reaping.
    return !/^\s*Z\s/.test(status.slice(status.lastIndexOf(')') + 1));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function fixture(t, blocking = false) {
  const directory = await mkdtemp(join(tmpdir(), 'kom-observer-process-'));
  const stateDir = join(directory, 'state'), config = join(directory, 'config.json');
  const calls = join(directory, 'calls.jsonl'), pids = join(directory, 'worker-pids.json');
  const fake = join(directory, 'fake-codex.mjs');
  const db = openDatabase(':memory:');
  const hub = createHubServer({ db, key, onConnectionError() {} });
  const sockets = new Set();
  hub.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => hub.listen(0, '127.0.0.1', resolve));
  const configuration = { hub: `http://127.0.0.1:${hub.address().port}`, key, host: 'same-physical-host' };
  await writeFile(config, JSON.stringify(configuration), { mode: 0o600 });
  // Never invokes the real Codex executable, reads profiles, or accesses a model provider.
  await writeFile(fake, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ input, args: process.argv.slice(2) }) + '\\n');
console.error(${JSON.stringify(key)});
if (${blocking}) {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'inherit' });
  writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
  setInterval(() => {}, 1000);
} else {
  writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify({ category: 'bug', priority: 'normal', summary: 'Needs investigation.', reply: 'Please provide the reproduction steps.' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Structured response saved.' } }));
}
`, { mode: 0o700 });
  const processes = [];
  const link = new HubLink(configuration);
  let connects = 0;
  link.start(async () => { connects++; }, () => {});
  t.after(async () => {
    for (const process of processes) {
      if (process.child.exitCode === null && process.child.signalCode === null) {
        process.child.kill('SIGTERM');
        await Promise.race([process.closed, delay(2500)]);
        try { globalThis.process.kill(-process.child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
      }
    }
    const workerIds = await contents(pids);
    if (workerIds) for (const pid of JSON.parse(workerIds)) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
    await link.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => hub.close(resolve));
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await eventually(() => link.connected, 'interactive link connects');
  const source = (await link.request('session.upsert', { op: 'register', reg_id: randomUUID(), session: { host: configuration.host, name: 'interactive', vendor: 'other' } })).session;
  await link.request('topic.join', { session_id: source.id, name: topic });
  return {
    db, stateDir, config, calls, pids, link, get connects() { return connects; },
    start() {
      const child = spawn(process.execPath, [entry, 'run', '--state-dir', stateDir, '--config', config, '--codex', fake,
        '--poll-ms', '1000', '--cooldown-ms', '1000', '--timeout-ms', '10000'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const instance = { child, stdout: '', stderr: '', closed: null };
      child.stdout.on('data', chunk => { instance.stdout += chunk; });
      child.stderr.on('data', chunk => { instance.stderr += chunk; });
      instance.closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
      processes.push(instance);
      return instance;
    },
    async stop(instance) {
      instance.child.kill('SIGTERM');
      const result = await Promise.race([instance.closed, delay(5000).then(() => 'timeout')]);
      assert.notEqual(result, 'timeout', 'service stops within its termination budget');
      assert.deepEqual(result, { code: 0, signal: null });
    },
    observer() { return db.prepare("SELECT * FROM sessions WHERE role='kommutator-feedback-monitor'").get(); },
    replies(id) { return db.prepare('SELECT * FROM messages WHERE reply_to=?').all(id); },
    async send(body) {
      return link.request('message.send', { session_id: source.id, idempotency_key: randomUUID(), message: { from: '', to: [`topic:${topic}`], kind: 'topic', priority: 'fyi', body } });
    },
  };
}

test('actual observer isolates its host, holds a kernel lock and resumes its mailbox without duplicate work', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const first = f.start();
  await eventually(() => first.stdout.includes('connected'), 'observer connects');
  const observer = f.observer();
  assert.notEqual(observer.host, 'same-physical-host');
  assert.equal(f.connects, 1, 'interactive WebSocket was not displaced');
  assert.equal(f.link.connected, true);
  const duplicate = f.start();
  assert.deepEqual(await duplicate.closed, { code: 75, signal: null }, 'kernel flock rejects a competing supervisor');
  const firstMessage = await f.send(`Topic discovery fails. Accidentally pasted ${key}`);
  await eventually(() => f.replies(firstMessage.id).length === 1, 'first feedback reply');
  await f.stop(first);
  const whileStopped = await f.send('New feedback while observer is offline.');
  const second = f.start();
  await eventually(() => f.replies(whileStopped.id).length === 1, 'offline backlog reply');
  assert.equal(f.observer().id, observer.id, 'same mailbox survives restart');
  await f.stop(second);
  const third = f.start();
  await eventually(() => third.stdout.includes('connected'), 'third startup');
  await delay(1300);
  await f.stop(third);
  assert.equal(f.replies(firstMessage.id).length, 1);
  assert.equal(f.replies(whileStopped.id).length, 1);
  const invocations = (await contents(f.calls)).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(invocations.length, 2, 'restart/own replies do not trigger more analysis');
  assert(invocations.every(call => !call.input.includes(key)), 'credential is removed before analysis');
  for (const instance of [first, second, third, duplicate]) assert(!(instance.stdout + instance.stderr).includes(key), 'worker stderr cannot expose credentials in service logs');
  assert.equal((await stat(f.stateDir)).mode & 0o777, 0o700);
  for (const filename of await readdir(f.stateDir)) assert.equal((await stat(join(f.stateDir, filename))).mode & 0o777, 0o600, `${filename} remains private`);
  assert.equal((await stat(f.config)).mode & 0o777, 0o600);
  assert.equal(f.connects, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_entries').get().n, 2);
});

test('SIGTERM aborts a stubborn analysis and kills its whole process group within the shutdown budget', { timeout: 20_000 }, async t => {
  const f = await fixture(t, true);
  const instance = f.start();
  await eventually(() => instance.stdout.includes('connected'), 'observer connects');
  await f.send('A blocking synthetic analysis must be cancellable.');
  const ids = JSON.parse(await eventually(() => contents(f.pids), 'analysis and descendant start'));
  assert.equal(ids.length, 2);
  assert((await Promise.all(ids.map(running))).every(Boolean));
  await f.stop(instance);
  await eventually(async () => (await Promise.all(ids.map(running))).every(value => !value), 'all worker descendants cease execution');
  assert(!(instance.stdout + instance.stderr).includes(key));
  assert(!(await readdir(f.stateDir)).some(name => name.startsWith('analysis-')), 'temporary analysis files removed after abort');
  assert.notEqual(f.observer().state, 'gone', 'stopping preserves the mailbox');
});
