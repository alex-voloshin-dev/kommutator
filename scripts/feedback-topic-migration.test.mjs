import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Journal, FEEDBACK_TOPIC, LEGACY_FEEDBACK_TOPIC, observerIdentity, observerHost } from './lib/feedback-observer.mjs';
import { MaintainerQueue, loadPolicy } from './lib/feedback-maintainer.mjs';
import { migrateFeedbackTopic } from './lib/feedback-topic-migration.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kom-topic-migrate-'));
  const observerState = join(dir, 'observer'), maintainerState = join(dir, 'maintainer');
  for (const path of [observerState, maintainerState]) await mkdir(path, { mode: 0o700 });
  const skillsRoot = join(dir, 'skills');
  for (const name of ['develop', 'release']) { await mkdir(join(skillsRoot, name), { recursive: true }); await writeFile(join(skillsRoot, name, 'SKILL.md'), 'fixture'); }
  const policyPath = join(dir, 'policy.json'), configPath = join(dir, 'config.json');
  const config = { hub: 'ws://127.0.0.1:1', host: 'fixture', key: 'synthetic-migration-key-only' };
  const policy = { enabled: true, repository: 'alex-voloshin-dev/kommutator', topic: LEGACY_FEEDBACK_TOPIC, standingAuthorization: 'verify-fix-test-review-publish-kommutator', model: 'test', effort: 'medium', acceptAfter: '2026-01-01T00:00:00Z', includeIds: [], codex: process.execPath, skillsRoot, observerDb: join(observerState, 'observer.db') };
  await writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 }); await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  const source = new Journal(policy.observerDb, observerIdentity(config, LEGACY_FEEDBACK_TOPIC));
  const session = { id: randomUUID(), host: observerHost(config.host, LEGACY_FEEDBACK_TOPIC), handle: 'monitor@fixture' };
  source.set('session', session); source.set('cursor', 9);
  const oldId = randomUUID(), newId = randomUUID(), pendingId = randomUUID(), capturedId = randomUUID();
  const message = topic => ({ from: 'reporter@fixture', to: [`topic:${topic}`], hops: 0, body: 'A confirmed diagnostic gap.', created_at: '2026-11-01T00:00:00Z' });
  const job = (id, seq, topic, stage) => ({ id, seq, stage, attempts: 0, nextAt: 0, boardOp: randomUUID(), replyKey: randomUUID(), message: message(topic), sanitizedMessage: { from: 'reporter@fixture', subject: '', body: 'A confirmed diagnostic gap.' }, analysis: { category: 'bug' } });
  source.save(job(oldId, 6, LEGACY_FEEDBACK_TOPIC, 'done'));
  const newJob = job(newId, 7, FEEDBACK_TOPIC, 'ignored'); delete newJob.analysis; source.save(newJob);
  source.save({ id: pendingId, seq: 8, stage: 'pending', attempts: 0, nextAt: 0, boardOp: randomUUID(), replyKey: randomUUID() });
  const queue = new MaintainerQueue(join(maintainerState, 'maintainer.db'), policy); queue.import(policy);
  const report = JSON.parse(queue.db.prepare('SELECT data FROM reports LIMIT 1').get().data);
  const replay = { boardOp: randomUUID(), replyKey: randomUUID(), boardDone: true, done: false };
  source.set(`maintainer-report:${report.id}`, replay);
  queue.close(); source.close();
  await chmod(policy.observerDb, 0o600); await chmod(join(maintainerState, 'maintainer.db'), 0o600);
  t.after(() => rm(dir, { recursive: true, force: true }));
  let captures = 0;
  const capture = async (_, journal) => {
    captures++;
    journal.capture([{ id: capturedId, seq: 10 }], 10);
    for (const item of journal.jobs()) if (!item.message) {
      item.message = message(item.id === capturedId ? FEEDBACK_TOPIC : LEGACY_FEEDBACK_TOPIC);
      item.sanitizedMessage = { from: item.message.from, subject: '', body: item.message.body };
      journal.save(item);
    }
  };
  return { dir, options: { observerState, maintainerState, policyPath, configPath, capture }, policy, config, session, oldId, newId, pendingId, capturedId, report, replay, captures: () => captures };
}

test('migration preserves identity, replay, cursor and fenced historic pending imports', async t => {
  const f = await fixture(t); const result = await migrateFeedbackTopic(f.options);
  const policy = await loadPolicy(f.options.policyPath, f.options.maintainerState);
  assert.equal(policy.topic, FEEDBACK_TOPIC);
  const source = new Journal(policy.observerDb, observerIdentity(f.config, FEEDBACK_TOPIC));
  const queue = new MaintainerQueue(join(f.options.maintainerState, 'maintainer.db'), policy);
  try {
    assert.deepEqual(source.get('session'), f.session); assert.equal(source.get('retained_host'), f.session.host); assert.equal(source.get('cursor'), 10);
    assert.deepEqual(source.get(`maintainer-report:${f.report.id}`), { ...f.replay, topic: LEGACY_FEEDBACK_TOPIC });
    assert.deepEqual(queue.jobs().map(job => job.id), [f.oldId]);
    assert.deepEqual(JSON.parse(queue.db.prepare('SELECT data FROM reports LIMIT 1').get().data), { ...f.report, topic: LEGACY_FEEDBACK_TOPIC });
    assert.equal(source.jobs().find(job => job.id === f.newId).stage, 'pending');
    assert.equal(source.jobs().find(job => job.id === f.capturedId).topic, FEEDBACK_TOPIC);
    const historical = source.jobs().find(job => job.id === f.pendingId); historical.stage = 'done'; historical.analysis = { category: 'bug' }; source.save(historical);
    const late = { ...historical, id: randomUUID(), seq: 11 }; source.save(late);
    queue.import(policy);
    assert.deepEqual(queue.jobs().map(job => job.id), [f.oldId, f.pendingId]);
    assert.ok(!queue.jobs().some(job => job.id === late.id));
    for (const name of ['observer.db', 'maintainer.db', 'policy.json']) assert.equal((await stat(join(result.backup, name))).mode & 0o777, 0o600);
  } finally { source.close(); queue.close(); }
  assert.equal((await migrateFeedbackTopic(f.options)).replayed, true); assert.equal(f.captures(), 1);
});

test('every interrupted phase resumes without new report IDs or losing replay routing', async t => {
  for (const phase of ['prepared', 'captured', 'observer', 'queue', 'policy', 'ready']) {
    const f = await fixture(t);
    await assert.rejects(migrateFeedbackTopic({ ...f.options, checkpoint: value => { if (value === phase) throw new Error('simulated crash'); } }), /simulated crash/);
    if (!['prepared', 'ready'].includes(phase)) {
      const raw = new DatabaseSync(f.policy.observerDb);
      const identity = JSON.parse(raw.prepare("SELECT value FROM meta WHERE key='identity'").get().value); raw.close();
      assert.throws(() => new Journal(f.policy.observerDb, identity), /migration incomplete/);
      assert.throws(() => new MaintainerQueue(join(f.options.maintainerState, 'maintainer.db'), f.policy), /migration incomplete/);
    }
    await migrateFeedbackTopic(f.options);
    const policy = await loadPolicy(f.options.policyPath, f.options.maintainerState);
    const queue = new MaintainerQueue(join(f.options.maintainerState, 'maintainer.db'), policy);
    assert.deepEqual(queue.jobs().map(job => job.id), [f.oldId]);
    assert.equal(queue.db.prepare('SELECT count(*) AS n FROM reports').get().n, 1); queue.close();
    assert.equal(f.captures(), 1);
  }
});

test('running jobs and wrong configuration refuse before snapshots or capture', async t => {
  const f = await fixture(t); const queue = new MaintainerQueue(join(f.options.maintainerState, 'maintainer.db'), f.policy);
  const job = queue.jobs()[0]; queue.transition(job, 'running', 'active'); queue.close();
  await assert.rejects(migrateFeedbackTopic(f.options), /active engineering job/); assert.equal(f.captures(), 0);
  await assert.rejects(readFile(join(f.options.maintainerState, 'topic-migration.json')), { code: 'ENOENT' });
});

test('capture failure preserves old identities and retry captures before switching', async t => {
  const f = await fixture(t);
  await assert.rejects(migrateFeedbackTopic({ ...f.options, capture: async () => { throw new Error('offline hub'); } }), /offline hub/);
  assert.equal(JSON.parse(await readFile(f.options.policyPath)).topic, LEGACY_FEEDBACK_TOPIC);
  assert.throws(() => new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC)), /migration incomplete/);
  const source = new DatabaseSync(f.policy.observerDb);
  assert.equal(JSON.parse(source.prepare("SELECT value FROM meta WHERE key='identity'").get().value), observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC)); source.close();
  await migrateFeedbackTopic(f.options); assert.equal(f.captures(), 1);
});


test('wrong config and public input permissions refuse without capture or recovery marker', async t => {
  for (const change of ['host', 'permissions']) {
    const f = await fixture(t);
    if (change === 'host') await writeFile(f.options.configPath, JSON.stringify({ ...f.config, host: 'unrelated-host' }));
    else await chmod(f.options.configPath, 0o644);
    await assert.rejects(migrateFeedbackTopic(f.options));
    assert.equal(f.captures(), 0);
    await assert.rejects(readFile(join(f.options.maintainerState, 'topic-migration.json')), { code: 'ENOENT' });
  }
});

test('real hub retains old-parent authority and lost-ACK replay while new feedback moves topics', async t => {
  const { createConformanceHarness } = await import('../packages/hub/dist/testing.js');
  const { FeedbackObserver } = await import('./lib/feedback-observer.mjs');
  const f = await fixture(t), harness = createConformanceHarness();
  t.after(() => harness.close());
  harness.db.prepare("INSERT INTO topics(name,kind) VALUES (?,'adhoc')").run(LEGACY_FEEDBACK_TOPIC);
  const host = f.session.host;
  const peer = harness.connect(host), sender = harness.connect('migration-reporter');
  const register = (connection, name, host) => connection.request('session.upsert', { op: 'register', reg_id: randomUUID(), session: { host, name, vendor: 'other' } }).session;
  const session = register(peer, 'monitor', host), author = register(sender, 'reporter', 'migration-reporter');
  for (const topic of [LEGACY_FEEDBACK_TOPIC, FEEDBACK_TOPIC]) {
    peer.request('topic.join', { session_id: session.id, name: topic });
    sender.request('topic.join', { session_id: author.id, name: topic });
  }
  const send = topic => sender.request('message.send', { session_id: author.id, idempotency_key: randomUUID(), message: { from: '', to: [`topic:${topic}`], kind: 'topic', priority: 'fyi', body: 'Reproducible feedback for migration.' } });
  const old = send(LEGACY_FEEDBACK_TOPIC);
  const journal = new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
  journal.db.exec('DELETE FROM jobs'); journal.set('session', session); journal.set('cursor', 0);
  const queue = new DatabaseSync(join(f.options.maintainerState, 'maintainer.db')); queue.exec('DELETE FROM jobs; DELETE FROM reports'); queue.close();
  let lost = true, clock = 1_000_000;
  const calls = [];
  const link = { connected: true, close: async () => {}, request: async (method, params) => {
    const result = peer.request(method, params);
    if (method === 'message.send') {
      calls.push(params);
      if (lost) { lost = false; throw new Error('lost acknowledgement after commit'); }
    }
    return result;
  } };
  const analyze = async () => ({ category: 'bug', priority: 'normal', summary: 'Investigate.', reply: 'Recorded.' });
  const makeObserver = (journal, topic) => new FeedbackObserver({ journal, topic, host, link, analyze, now: () => clock, cooldownMs: 0, log: () => {} });
  const before = makeObserver(journal, LEGACY_FEEDBACK_TOPIC); before.ready = true; await before.tick();
  const pending = journal.jobs().find(job => job.id === old.id);
  assert.equal(pending.stage, 'analyzed'); assert.equal(calls.length, 1);
  journal.close();
  await migrateFeedbackTopic({ ...f.options, capture: async (_, source) => {
    const result = peer.request('inbox.list', { session_id: session.id, since_seq: source.get('cursor'), unread_only: false, limit: 200 });
    source.capture(result.headers, result.cursor);
    for (const job of source.jobs()) if (!job.message) { job.message = peer.request('message.read', { session_id: session.id, id: job.id }).message; source.save(job); }
  } });
  const migrated = new Journal(f.policy.observerDb, observerIdentity(f.config, FEEDBACK_TOPIC));
  t.after(() => migrated.close());
  clock += 120_000;
  const after = makeObserver(migrated, FEEDBACK_TOPIC); after.ready = true;
  await after.processNext();
  assert.deepEqual(calls[1], calls[0], 'replay keeps original session, parent, old topic, body and key');
  assert.equal(migrated.jobs().find(job => job.id === old.id).stage, 'done');
  assert.equal(harness.db.prepare('SELECT count(*) AS n FROM messages WHERE from_session=?').get(session.id).n, 1);
  const fresh = send(FEEDBACK_TOPIC), archived = send(LEGACY_FEEDBACK_TOPIC);
  for (let i = 0; i < 5; i++) await after.tick();
  assert.equal(migrated.jobs().find(job => job.id === fresh.id).stage, 'done');
  assert.equal(migrated.jobs().find(job => job.id === archived.id).stage, 'ignored');
  assert.equal(harness.db.prepare('SELECT count(*) AS n FROM messages WHERE from_session=?').get(session.id).n, 2);
  assert.deepEqual(calls.at(-1).message.to, [`topic:${FEEDBACK_TOPIC}`]);
  assert.equal(calls.at(-1).message.reply_to, fresh.id);
  assert.notEqual(calls.at(-1).idempotency_key, calls[0].idempotency_key);
});

test('CLI refuses either active service lock before touching journals', async t => {
  const { spawn, execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  for (const [state, filename, standalone] of [['observerState', 'observer.lock', false], ['maintainerState', 'maintainer.lock', false], ['observerState', 'observer.lock', true]]) {
    const f = await (standalone ? standaloneFixture(t) : fixture(t));
    const holder = spawn('flock', ['--no-fork', join(f.options[state], filename), process.execPath, '-e', "process.stdout.write('locked');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => holder.once('close', resolve));
    t.after(() => { holder.kill(); });
    await new Promise((resolve, reject) => { holder.once('error', reject); holder.stdout.once('data', resolve); holder.once('exit', code => reject(new Error(`lock holder exited ${code}`))); });
    try {
      await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./migrate-feedback-topic.mjs', import.meta.url)), standalone ? 'apply-observer-only' : 'apply', '--observer-state', f.options.observerState, '--maintainer-state', f.options.maintainerState, '--policy', f.options.policyPath, '--config', f.options.configPath]), error => error.code === 75);
      await assert.rejects(readFile(join(f.options.maintainerState, 'topic-migration.json')), { code: 'ENOENT' });
      const source = new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
      assert.deepEqual(source.get('session'), f.session); source.close();
    } finally { holder.kill(); await closed; }
  }
});

async function standaloneFixture(t) {
  const f = await fixture(t);
  await rm(f.options.maintainerState, { recursive: true });
  await rm(f.options.policyPath);
  await rm(join(f.dir, 'skills'), { recursive: true });
  const source = new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
  source.db.prepare("DELETE FROM meta WHERE key LIKE 'maintainer-report:%'").run();
  const jobs = source.jobs(); source.close();
  return { ...f, jobs, options: { ...f.options, observerOnly: true } };
}

test('standalone migration needs no maintainer installation and retains observer replay state', async t => {
  const f = await standaloneFixture(t);
  const result = await migrateFeedbackTopic(f.options);
  const source = new Journal(f.policy.observerDb, observerIdentity(f.config, FEEDBACK_TOPIC));
  try {
    assert.deepEqual(source.get('session'), f.session);
    assert.equal(source.get('retained_host'), f.session.host);
    assert.equal(source.get('cursor'), 10);
    for (const original of f.jobs) {
      const migrated = source.jobs().find(job => job.id === original.id);
      assert.equal(migrated.boardOp, original.boardOp);
      assert.equal(migrated.replyKey, original.replyKey);
      assert.equal(migrated.seq, original.seq);
    }
    assert.equal(source.jobs().find(job => job.id === f.oldId).topic, LEGACY_FEEDBACK_TOPIC);
    assert.equal(source.jobs().find(job => job.id === f.newId).stage, 'pending');
    assert.equal(source.jobs().find(job => job.id === f.capturedId).topic, FEEDBACK_TOPIC);
  } finally { source.close(); }
  assert.equal((await stat(result.backup)).mode & 0o777, 0o700);
  assert.equal((await stat(join(result.backup, 'observer.db'))).mode & 0o777, 0o600);
  const backup = new DatabaseSync(join(result.backup, 'observer.db'), { readOnly: true });
  try {
    assert.equal(JSON.parse(backup.prepare("SELECT value FROM meta WHERE key='cursor'").get().value), 9);
    assert.equal(JSON.parse(backup.prepare("SELECT value FROM meta WHERE key='identity'").get().value), observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
  } finally { backup.close(); }
  assert.equal((await migrateFeedbackTopic(f.options)).replayed, true);
  assert.equal(f.captures(), 1);
  for (const path of [f.options.maintainerState, f.options.policyPath, join(f.dir, 'skills')]) await assert.rejects(stat(path), { code: 'ENOENT' });
});

test('standalone migration recovers interrupted phases while fencing partial startup', async t => {
  for (const phase of ['prepared', 'captured', 'observer', 'ready']) {
    const f = await standaloneFixture(t);
    await assert.rejects(migrateFeedbackTopic({ ...f.options, checkpoint: value => { if (value === phase) throw new Error('standalone crash'); } }), /standalone crash/);
    if (['captured', 'observer'].includes(phase)) {
      const raw = new DatabaseSync(f.policy.observerDb);
      const identity = JSON.parse(raw.prepare("SELECT value FROM meta WHERE key='identity'").get().value); raw.close();
      assert.throws(() => new Journal(f.policy.observerDb, identity), /migration incomplete/);
    }
    await migrateFeedbackTopic(f.options);
    const source = new Journal(f.policy.observerDb, observerIdentity(f.config, FEEDBACK_TOPIC));
    try { assert.deepEqual(source.get('session'), f.session); assert.equal(source.get('cursor'), 10); }
    finally { source.close(); }
    assert.equal(f.captures(), 1);
    await assert.rejects(stat(f.options.maintainerState), { code: 'ENOENT' });
    await assert.rejects(stat(f.options.policyPath), { code: 'ENOENT' });
  }
});

test('standalone mode refuses existing maintainer state, policy or historical report metadata', async t => {
  for (const evidence of ['state', 'policy', 'report']) {
    const f = await standaloneFixture(t);
    if (evidence === 'state') await mkdir(f.options.maintainerState, { mode: 0o700 });
    if (evidence === 'policy') await writeFile(f.options.policyPath, JSON.stringify(f.policy), { mode: 0o600 });
    if (evidence === 'report') {
      const source = new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
      source.set(`maintainer-report:${randomUUID()}`, f.replay); source.close();
    }
    await assert.rejects(migrateFeedbackTopic(f.options));
    assert.equal(f.captures(), 0);
    await assert.rejects(stat(join(f.options.observerState, 'topic-migration.json')), { code: 'ENOENT' });
    const source = new Journal(f.policy.observerDb, observerIdentity(f.config, LEGACY_FEEDBACK_TOPIC));
    try { assert.deepEqual(source.get('session'), f.session); assert.equal(source.get('cursor'), 9); }
    finally { source.close(); }
  }
});

test('standalone mode cannot replace an interrupted joint migration after its recovery files disappear', async t => {
  const f = await fixture(t);
  await assert.rejects(migrateFeedbackTopic({ ...f.options, checkpoint: phase => { if (phase === 'captured') throw new Error('joint interrupted'); } }), /joint interrupted/);
  await rm(f.options.maintainerState, { recursive: true }); await rm(f.options.policyPath);
  const raw = new DatabaseSync(f.policy.observerDb);
  raw.prepare("DELETE FROM meta WHERE key LIKE 'maintainer-report:%'").run(); raw.close();
  await assert.rejects(migrateFeedbackTopic({ ...f.options, observerOnly: true }), /recovery marker|incomplete migration/);
  assert.equal(f.captures(), 1);
  await assert.rejects(stat(join(f.options.observerState, 'topic-migration.json')), { code: 'ENOENT' });
});
