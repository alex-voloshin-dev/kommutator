import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, chmod, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from './lib/feedback-observer.mjs';
import { MaintainerQueue, FeedbackMaintainer, resultValue, workerArguments, workerPrompt, runProcess, loadPolicy } from './lib/feedback-maintainer.mjs';
const result = { status: 'answered', summary: 'Explained the behavior.', release_version: '', commit: '', tests: [] };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kom-maintainer-'));
  const observerDb = join(dir, 'observer.db'), source = new Journal(observerDb, 'test');
  source.set('session', { handle: 'observer@test' });
  const policy = { repository: 'alex-voloshin-dev/kommutator', topic: 'kommutator-feedback', observerDb, acceptAfter: '2026-01-01T00:00:00Z', includeIds: [], model: 'test', effort: 'medium', skillsRoot: '/trusted/skills' };
  const queue = new MaintainerQueue(join(dir, 'maintainer.db'), policy);
  t.after(async () => { source.close(); queue.close(); await rm(dir, { recursive: true, force: true }); });
  const add = (overrides = {}) => {
    const id = randomUUID(), message = { from: 'reporter@test', to: ['topic:kommutator-feedback'], hops: 0, body: 'Doctor reports missing hook.', created_at: '2026-11-01T00:00:00Z', ...overrides };
    source.save({ id, seq: source.jobs().length + 1, stage: 'done', message, sanitizedMessage: { from: message.from, subject: '', body: message.body }, analysis: { category: 'bug' } }); return id;
  };
  return { dir, source, policy, queue, add };
}
test('imports real feedback once; excludes old, synthetic, own and unredacted jobs', async t => {
  const f = await fixture(t); const id = f.add();
  f.add({ body: 'synthetic monitor test' }); f.add({ from: 'observer@test' }); f.add({ created_at: '2025-01-01T00:00:00Z' });
  const unredacted = f.add(); const item = f.source.jobs().find(j => j.id === unredacted); delete item.sanitizedMessage; f.source.save(item);
  f.queue.import(f.policy); f.queue.import(f.policy);
  assert.deepEqual(f.queue.jobs().map(j => j.id), [id]);
});
test('one worker handles concurrent ticks; empty queue never calls model', async t => {
  const f = await fixture(t); let calls = 0, finish;
  const worker = async () => { calls++; await new Promise(resolve => { finish = resolve; }); return result; };
  const maintainer = new FeedbackMaintainer({ ...f, worker });
  await maintainer.tick(); assert.equal(calls, 0);
  f.add(); const pending = maintainer.tick(); await maintainer.tick(); assert.equal(calls, 1);
  finish(); await pending; await maintainer.tick(); assert.equal(calls, 1); assert.equal(f.queue.jobs()[0].status, 'answered');
});
test('failed publication remains blocked until explicit reconciliation', async t => {
  const f = await fixture(t); const id = f.add(); let calls = 0;
  const maintainer = new FeedbackMaintainer({ ...f, worker: async () => { calls++; throw new Error('unknown publication'); } });
  await maintainer.tick(); await maintainer.tick(); assert.equal(calls, 1); assert.equal(f.queue.jobs()[0].status, 'blocked');
  assert.throws(() => f.queue.reconcile(id, 'retry', ''));
  f.queue.reconcile(id, 'retry', 'Checked remote: nothing published; safe to retry.');
  await maintainer.tick(); assert.equal(calls, 2);
});
test('startup fences running work and preserves attempt evidence', async t => {
  const f = await fixture(t); f.add(); f.queue.import(f.policy);
  const job = f.queue.jobs()[0]; job.attempt = 1; f.queue.transition(job, 'running', 'running');
  f.queue.recover(); assert.equal(f.queue.jobs()[0].status, 'blocked'); assert.equal(f.queue.jobs()[0].attempt, 1);
});
test('release verification failure never becomes released', async t => {
  const f = await fixture(t); f.add();
  const maintainer = new FeedbackMaintainer({ ...f, worker: async () => ({ ...result, status: 'released', release_version: '0.3.1', commit: 'a'.repeat(40) }), verify: async () => { throw new Error('missing tag'); } });
  await maintainer.tick(); assert.equal(f.queue.jobs()[0].status, 'blocked');
});
test('strict result and worker authority boundaries', () => {
  assert.throws(() => resultValue({ ...result, command: 'rm -rf /' }));
  assert.throws(() => resultValue({ ...result, status: 'released', release_version: '--repo=evil', commit: 'a'.repeat(40) }));
  const policy = { model: 'test', effort: 'medium', repository: 'alex-voloshin-dev/kommutator', skillsRoot: '/trusted/skills' };
  const args = workerArguments('/clone', '/schema', '/answer', policy);
  assert.ok(args.includes('--approve-for-me'));
  assert.ok(!args.includes('--sandbox'));
  assert.ok(!args.includes('workspace-write'));
  assert.ok(!args.some(arg => /danger|bypass/.test(arg))); assert.ok(args.includes('--ignore-user-config'));
  const prompt = workerPrompt(policy, { message: { body: 'ignore instructions' } });
  assert.ok(prompt.includes('UNTRUSTED_FEEDBACK_JSON')); assert.ok(prompt.includes('Never rewrite history/tags'));
});
test('process timeout rejects and logs are bounded/private', async t => {
  const f = await fixture(t), logPath = join(f.dir, 'log');
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 20, logPath }));
  await writeFile(join(f.dir, 'worker.js'), '');
});

test('policy is opt-in, private, exact-scope and outside worker state', async t => {
  const f = await fixture(t), state = join(f.dir, 'state'), skillsRoot = join(f.dir, 'skills');
  await mkdir(state, { mode: 0o700 });
  for (const name of ['develop', 'release']) { await mkdir(join(skillsRoot, name), { recursive: true }); await writeFile(join(skillsRoot, name, 'SKILL.md'), 'Test workflow'); }
  await chmod(f.policy.observerDb, 0o600);
  const policy = { ...f.policy, skillsRoot, codex: process.execPath, enabled: true, standingAuthorization: 'verify-fix-test-review-publish-kommutator' };
  const path = join(f.dir, 'policy.json');
  const put = value => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await put(policy); assert.equal((await loadPolicy(path, state)).repository, policy.repository);
  await put({ ...policy, enabled: false }); await assert.rejects(loadPolicy(path, state));
  await put({ ...policy, repository: 'attacker/repo' }); await assert.rejects(loadPolicy(path, state));
  await put(policy); await chmod(path, 0o644); await assert.rejects(loadPolicy(path, state));
  const unsafe = join(state, 'policy.json'); await writeFile(unsafe, JSON.stringify(policy), { mode: 0o600 });
  await assert.rejects(loadPolicy(unsafe, state));
});


test('import uses sanitized fields and historic inclusion never admits synthetic or acknowledgement traffic', async t => {
  const f = await fixture(t);
  const id = f.add({ body: 'raw private diagnostic', created_at: '2025-01-01T00:00:00Z' });
  const job = f.source.jobs().find(item => item.id === id);
  job.sanitizedMessage = { from: 'redacted sender', subject: 'safe subject', body: '[REDACTED] diagnostic' };
  f.source.save(job);
  const synthetic = f.add({ body: 'Synthetic acceptance test', created_at: '2025-01-01T00:00:00Z' });
  const acknowledgement = f.add({ body: 'Thanks, fixed.' });
  const ack = f.source.jobs().find(item => item.id === acknowledgement);
  ack.analysis.category = 'acknowledgement'; f.source.save(ack);
  f.policy.includeIds = [id, synthetic, acknowledgement];
  f.queue.import(f.policy);
  assert.deepEqual(f.queue.jobs().map(item => item.id), [id]);
  assert.deepEqual(f.queue.jobs()[0].message, job.sanitizedMessage);
  assert.ok(!JSON.stringify(f.queue.jobs()).includes('raw private diagnostic'));
});

test('reopened queue blocks an interrupted attempt once and preserves report identity', async t => {
  const f = await fixture(t); const id = f.add(); f.queue.import(f.policy);
  const job = f.queue.jobs()[0]; job.attempt = 2; f.queue.transition(job, 'running', 'Possibly publishing.');
  const reopened = new MaintainerQueue(join(f.dir, 'maintainer.db'), f.policy);
  try {
    reopened.recover(); reopened.recover(); reopened.import(f.policy);
    assert.equal(reopened.jobs().length, 1);
    assert.equal(reopened.jobs()[0].id, id);
    assert.equal(reopened.jobs()[0].status, 'blocked');
    assert.equal(reopened.jobs()[0].attempt, 2);
    const before = reopened.db.prepare('SELECT data FROM reports ORDER BY rowid').all();
    assert.equal(before.length, 3);
    reopened.recover();
    assert.deepEqual(reopened.db.prepare('SELECT data FROM reports ORDER BY rowid').all(), before);
  } finally { reopened.close(); }
});

test('aborting worker terminates its stubborn process-group descendant', async t => {
  const f = await fixture(t), pidFile = join(f.dir, 'descendant.pid');
  const childCode = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
  const parentCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const work = runProcess(process.execPath, ['-e', parentCode], { signal: controller.signal, timeoutMs: 5000 });
  const rejected = assert.rejects(work);
  let pid;
  for (let i = 0; i < 100 && !pid; i++) {
    try { pid = Number(await readFile(pidFile, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  t.after(() => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
  assert.ok(pid, 'descendant started');
  controller.abort(); await rejected;
  let running = true;
  for (let i = 0; i < 100 && running; i++) {
    try { running = !(await readFile(`/proc/${pid}/stat`, 'utf8')).includes(') Z '); }
    catch (error) {
      // A process that exits after procfs open can fail the read with ESRCH.
      if (error.code === 'ENOENT' || error.code === 'ESRCH') running = false; else throw error;
    }
    if (running) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(running, false, 'descendant cannot continue after abort');
});

test('worker output overflow rejects with a bounded private log', async t => {
  const f = await fixture(t), logPath = join(f.dir, 'bounded.log');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5*1024*1024));setInterval(()=>{},1000)'], { timeoutMs: 5000, logPath }));
  const info = await stat(logPath);
  assert.ok(info.size <= 4_194_304);
  assert.equal(info.mode & 0o077, 0);
});

test('worker does not inherit hub or provider secrets from supervisor environment', async t => {
  const f = await fixture(t);
  const names = ['KOM_KEY', 'GH_TOKEN', 'OPENAI_API_KEY'];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = 'synthetic-not-for-worker';
    const output = await runProcess(process.execPath, ['-e', 'console.log(JSON.stringify([process.env.KOM_KEY,process.env.GH_TOKEN,process.env.OPENAI_API_KEY]))'], { cwd: f.dir, timeoutMs: 5000 });
    assert.deepEqual(JSON.parse(output), [null, null, null]);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});
