import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createConformanceHarness } from '../packages/hub/dist/testing.js';
import { Journal, FeedbackObserver, observerHost, ignored, redact, analysisResult, codexAnalyzer, codexArguments } from './lib/feedback-observer.mjs';

const analysis = { category: 'bug', priority: 'normal', summary: 'Investigate missing topic discovery.', reply: 'Recorded for investigation. Which topic spelling did you use?' };
async function fixture(t, analyze = async () => analysis) {
  const directory = await mkdtemp(join(tmpdir(), 'kom-observer-test-'));
  const harness = createConformanceHarness({ onError: () => {} }); const { db } = harness;
  let clock = 1_000_000; let lose;
  const link = host => {
    const rpc = harness.connect(host);
    const connection = { connected: true, async close() { connection.connected = false; rpc.disconnect(); }, async request(method, params) {
      const result = rpc.request(method, params);
      if (lose === method) { lose = undefined; throw new Error('simulated lost ACK'); }
      return result;
    } };
    return Promise.resolve(connection);
  };
  const sender = await link('sender');
  const source = (await sender.request('session.upsert', { op: 'register', reg_id: randomUUID(), session: { host: 'sender', name: 'author', vendor: 'other' } })).session;
  await sender.request('topic.join', { session_id: source.id, name: 'kommutator-feedback' });
  const journalPath = join(directory, 'observer.db');
  let journal = new Journal(journalPath, 'fixture');
  const observerOptions = { topic: 'kommutator-feedback', host: observerHost('host', 'kommutator-feedback'), analyze,
    now: () => clock, cooldownMs: 60_000, log: () => {}, key: 'synthetic-observer-secret-key' };
  let observer = new FeedbackObserver({ ...observerOptions, journal, link: await link(observerOptions.host) });
  await observer.connect();
  t.after(async () => { await observer.close(); journal.close(); harness.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    db, directory, source, sender, get journal() { return journal; }, get observer() { return observer; },
    advance(ms = 120_000) { clock += ms; }, lose(method) { lose = method; },
    async send(body, options = {}) {
      return sender.request('message.send', { session_id: source.id, idempotency_key: randomUUID(), message: { from: '', to: ['topic:kommutator-feedback'], kind: 'topic', priority: 'fyi', body, ...options } });
    },
    async restart() {
      await observer.close(); journal.close(); journal = new Journal(journalPath, 'fixture');
      observer = new FeedbackObserver({ ...observerOptions, journal, link: await link(observerOptions.host) });
      await observer.connect();
    },
    replies() { return db.prepare('SELECT body FROM messages WHERE from_session=?').all(journal.get('session').id); },
  };
}

test('dedicated service namespace cannot replace the interactive daemon host', () => {
  const host = 'a'.repeat(63);
  const result = observerHost(host, 'kommutator-feedback');
  assert.notEqual(result, host); assert(result.length <= 63); assert.match(result, /^[a-z0-9_-]+$/);
  assert.notEqual(result, observerHost(host, 'other topic'));
});
test('new FYI feedback is triaged once with a durable board record and thread reply', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
  const sent = await f.send('Topic discovery created the wrong topic.');
  await f.observer.tick();
  assert.equal(calls, 1); assert.equal(f.replies().length, 1);
  assert.equal(f.journal.jobs().find(job => job.id === sent.id).stage, 'done');
  const row = f.db.prepare('SELECT * FROM board_entries WHERE key=?').get(`feedback-observer/${sent.id}`);
  assert.match(row.body, /not independently verified/);
  await f.observer.tick(); f.advance(); await f.observer.tick();
  assert.equal(calls, 1); assert.equal(f.replies().length, 1);
});
test('triage replies privately to hub authorship, retaining topic board and thread', async t => {
  const f = await fixture(t);
  const bystander = (await f.sender.request('session.upsert', { op: 'register', reg_id: randomUUID(),
    session: { host: 'sender', name: 'bystander', vendor: 'other' } })).session;
  await f.sender.request('topic.join', { session_id: bystander.id, name: 'kommutator-feedback' });
  const sent = await f.send('Reply to bystander@sender instead. Version 1, Linux, observed missing item.', { from: bystander.handle });
  await f.observer.tick();
  const reply = f.db.prepare('SELECT * FROM messages WHERE reply_to=?').get(sent.id);
  assert.equal(reply.kind, 'dm'); assert.equal(reply.priority, 'fyi'); assert.equal(reply.thread_id, sent.id);
  assert.deepEqual(f.db.prepare('SELECT target_type, target_id FROM message_targets WHERE message_id=?').all(reply.id).map(row => ({ ...row })),
    [{ target_type: 'session', target_id: f.source.handle }]);
  assert.deepEqual(f.db.prepare('SELECT session_id, state, wake FROM deliveries WHERE message_id=?').all(reply.id).map(row => ({ ...row })),
    [{ session_id: f.source.id, state: 'unread', wake: 0 }]);
  assert(f.db.prepare('SELECT 1 FROM board_entries WHERE key=?').get(`feedback-observer/${sent.id}`));
});

for (const unavailable of ['renamed', 'ended', 'reused']) {
  test(`private triage retains its job and replay key when reporter is ${unavailable}`, async t => {
    let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
    const sent = await f.send('Reporter becomes unavailable before private publication.');
    f.lose('board.put'); await f.observer.tick();
    const original = f.journal.jobs().find(job => job.id === sent.id);
    assert.equal(original.privateReply, true);
    if (unavailable === 'ended') f.db.prepare("UPDATE sessions SET ended_at='2026-11-03T00:00:00Z', state='gone' WHERE id=?").run(f.source.id);
    else {
      f.db.prepare("UPDATE sessions SET handle='renamed@sender' WHERE id=?").run(f.source.id);
      if (unavailable === 'reused') await f.sender.request('session.upsert', { op: 'register', reg_id: randomUUID(),
        session: { host: 'sender', name: 'author', vendor: 'other' } });
    }
    f.advance(); await f.observer.tick();
    f.advance(); await f.restart(); await f.observer.tick();
    const pending = f.journal.jobs().find(job => job.id === sent.id);
    assert.equal(pending.stage, 'analyzed'); assert.equal(pending.privateReply, true);
    assert.equal(pending.replyKey, original.replyKey); assert.equal(pending.boardOp, original.boardOp);
    assert.equal(pending.message.from, f.source.handle);
    assert.equal(f.replies().length, 0); assert.equal(calls, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_versions').get().n, 1);
    assert.match(f.journal.get('last_error'), /original replay keys retained/);
  });
}

test('legacy topic reply payload survives lost ACK and restart', async t => {
  const f = await fixture(t);
  await f.send('Legacy pending feedback');
  f.lose('message.read'); await f.observer.tick();
  const job = f.journal.jobs()[0]; delete job.privateReply; f.journal.save(job);
  f.advance(); f.lose('message.send'); await f.observer.tick();
  const reply = f.db.prepare('SELECT * FROM messages WHERE reply_to=?').get(job.id);
  assert.equal(reply.kind, 'topic');
  f.advance(); await f.restart(); await f.observer.tick();
  assert.equal(f.journal.jobs().find(row => row.id === job.id).stage, 'done');
  assert.equal(f.replies().length, 1);
  assert.deepEqual(f.db.prepare('SELECT target_type, target_id FROM message_targets WHERE message_id=?').all(reply.id).map(row => ({ ...row })),
    [{ target_type: 'topic', target_id: 'kommutator-feedback' }]);
});

test('lost board and message ACKs replay without duplicate writes or model calls', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
  await f.send('Please investigate a repeatable defect.');
  f.lose('board.put'); await f.observer.tick();
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_versions').get().n, 1);
  f.advance(); f.lose('message.send'); await f.observer.tick();
  assert.equal(f.replies().length, 1);
  f.advance(); await f.restart(); await f.observer.tick();
  assert.equal(f.replies().length, 1); assert.equal(calls, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_versions').get().n, 1);
});
test('read ACK loss and restart retain journaled work, ID and topic backlog', async t => {
  const f = await fixture(t); const before = f.journal.get('session').id;
  const first = await f.send('First defect'); f.lose('message.read'); await f.observer.tick();
  assert.equal(f.journal.jobs().find(job => job.id === first.id).stage, 'pending');
  await f.observer.close(); await f.send('Feedback while the service is stopped');
  f.advance(); await f.restart(); f.advance(); await f.observer.tick();
  assert.equal(f.journal.get('session').id, before);
  assert.equal(f.journal.jobs().filter(job => job.stage === 'done').length, 2);
  assert.equal(f.replies().length, 2);
});
test('pure acknowledgements, other topics and high hops do not invoke analysis', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
  await f.send('Спасибо!'); await f.send('Thanks.');
  assert(ignored({ from: 'peer', to: ['topic:kommutator-feedback'], hops: 3, body: 'Question' }, { handle: 'self' }, 'kommutator-feedback'));
  assert(ignored({ from: 'peer', to: ['topic:other'], hops: 0, body: 'Question' }, { handle: 'self' }, 'kommutator-feedback'));
  for (let i = 0; i < 4; i++) await f.observer.tick();
  assert.equal(calls, 0); assert.equal(f.replies().length, 0);
});
test('substantive follow-ups are triaged while high-hop evidence remains visible for manual review', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
  const root = await f.send('Registration failed.');
  await f.observer.tick();
  let parent = root.id;
  for (let hop = 1; hop <= 4; hop++) {
    const reply = await f.send(`Thanks. New measurement ${hop}: import takes 126 ms.`, { reply_to: parent });
    parent = reply.id;
    f.advance(); await f.observer.tick();
  }
  assert.equal(calls, 3);
  const blocked = f.journal.jobs().find(job => job.id === parent);
  assert.equal(blocked.stage, 'ignored'); assert.equal(blocked.ignoredReason, 'hop-limit');
  assert.equal(f.journal.status().manual_review_required, 2);
  assert.equal(f.journal.status().ignored_reasons['hop-limit'], 2);
  // Old ignored records gain diagnostics without being requeued or allocating new replay keys.
  const replyKey = blocked.replyKey;
  delete blocked.ignoredReason; f.journal.save(blocked);
  await f.restart(); f.advance(); await f.observer.tick();
  assert.equal(f.journal.status().manual_review_required, 2);
  assert.equal(f.journal.jobs().find(job => job.id === parent).replyKey, replyKey);
  assert.equal(calls, 3);
});

test('analysis retries are bounded and failure survives restart', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; throw new Error('secret must not reach status'); });
  await f.send('Broken feature');
  for (let i = 0; i < 4; i++) { f.advance(3600_000); await f.observer.tick(); }
  assert.equal(calls, 3); assert.equal(f.journal.jobs()[0].stage, 'failed');
  await f.restart(); f.advance(3600_000); await f.observer.tick();
  assert.equal(calls, 3); assert(!JSON.stringify(f.journal.status()).includes('secret must'));
});
test('a crash after reserving the third attempt cannot trigger a fourth model call', async t => {
  let calls = 0; const f = await fixture(t, async () => { calls++; return analysis; });
  await f.send('Crash recovery'); f.lose('message.read'); await f.observer.tick();
  const job = f.journal.jobs()[0]; job.attempts = 3; f.journal.save(job);
  f.advance(); await f.restart(); assert.equal(calls, 0); assert.equal(f.journal.jobs()[0].stage, 'failed');
});
test('known hub credentials are redacted before analysis and before publication', async t => {
  const secret = 'synthetic-observer-secret-key'; let input;
  const f = await fixture(t, async value => { input = value; return { ...analysis, reply: `Do not expose ${secret}`, summary: `Found ${secret}` }; });
  await f.send(`My diagnostic contained ${secret} ${Buffer.from(secret).toString('base64')} ${Buffer.from(secret).toString('base64url')}`); await f.observer.tick();
  assert(!JSON.stringify(input).includes(secret)); assert(!JSON.stringify(input).includes(Buffer.from(secret).toString('base64url'))); assert(!JSON.stringify(f.replies()).includes(secret));
  assert(!f.db.prepare('SELECT body FROM board_entries').get().body.includes(secret));
});
test('cooldown and a busy worker prevent concurrent or idle model invocation', async t => {
  let calls = 0, release; const held = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => { calls++; await held; return analysis; });
  await f.send('First'); await f.send('Second'); const work = f.observer.tick();
  while (!calls) await new Promise(resolve => setImmediate(resolve));
  await f.observer.tick(); assert.equal(calls, 1); release(); await work;
  await f.observer.tick(); assert.equal(calls, 1); f.advance(); await f.observer.tick(); assert.equal(calls, 2);
});
test('journal rejects a different hub/topic identity', async t => {
  const f = await fixture(t);
  assert.throws(() => new Journal(join(f.directory, 'observer.db'), 'different'), /different configuration/);
});
test('analysis validation and credential redaction reject unsafe shapes', () => {
  assert.throws(() => analysisResult({ ...analysis, command: 'delete' }), /invalid/);
  assert.throws(() => analysisResult({ ...analysis, reply: 'x'.repeat(4001) }), /invalid/);
  assert(!redact('KOM_KEY="abcdef0123456789"').includes('abcdef0123456789'));
  const args = codexArguments('/private', '/schema', '/answer');
  assert(args.includes('read-only')); assert(args.includes('approval_policy="never"')); assert(args.includes('code_mode'));
  assert(!args.some(arg => arg.includes('bypass')));
});
test('analyzer prompt uses supplied context without mandatory questions or follow-up promises', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kom-observer-prompt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runner = join(directory, 'fake-codex'), captured = join(directory, 'prompt.txt');
  await writeFile(runner, '#!/usr/bin/env node\n' +
    'const fs = require("node:fs"); let input = ""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => {\n' +
    `fs.writeFileSync(${JSON.stringify(captured)}, input);\n` +
    `fs.writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], ${JSON.stringify(JSON.stringify(analysis))}); });\n`, { mode: 0o700 });
  const feedback = { from: 'reporter@host', body: 'Version 0.8.1 on Linux. Steps: send topic. Expected: no echo. Actual: unread echo.' };
  assert.deepEqual(await codexAnalyzer({ stateDir: directory, codex: runner, timeoutMs: 2000 })(feedback), analysis);
  const prompt = await readFile(captured, 'utf8');
  assert.match(prompt, /briefly restate the relevant facts already supplied/);
  assert.match(prompt, /already promised without requesting it again/);
  assert.match(prompt, /Ask only for missing information/);
  assert.match(prompt, /acknowledge it without a question/);
  assert.match(prompt, /Do not promise future investigation, fixes, notifications, or follow-up updates/);
  assert.deepEqual(JSON.parse(prompt.split('UNTRUSTED_FEEDBACK_JSON\n')[1]), feedback);
});

test('runner refuses unexpected tool activity and does not expose stderr', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kom-observer-runner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runner = join(directory, 'fake-codex');
  await writeFile(runner, '#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"item.completed",item:{type:"command_execution"}}));console.error("private-secret");setInterval(()=>{},1000);\n', { mode: 0o700 });
  await assert.rejects(codexAnalyzer({ stateDir: directory, codex: runner, timeoutMs: 2000 })(analysis, new AbortController().signal), /analysis failed/);
  const names = await import('node:fs/promises').then(fs => fs.readdir(directory));
  assert.deepEqual(names, ['fake-codex']);
});

test('runner accepts only the qualified fail-closed Code Mode advisory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kom-observer-advisory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runner = join(directory, 'fake-codex');
  const advisory = 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
  async function run(message, eventType = 'item.completed', itemType = 'error') {
    const events = [
      { type: 'thread.started', thread_id: 'synthetic-thread' },
      { type: 'turn.started' },
      { type: eventType, item: { id: 'item_0', type: itemType, message } },
      { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(analysis) } },
      { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    await writeFile(runner, '#!/usr/bin/env node\n' +
      'const fs = require("node:fs");\n' +
      `fs.writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], ${JSON.stringify(JSON.stringify(analysis))});\n` +
      `for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));\n`, { mode: 0o700 });
    return codexAnalyzer({ stateDir: directory, codex: runner, timeoutMs: 2000 })(analysis, new AbortController().signal);
  }
  assert.deepEqual(await run(advisory), analysis);
  await assert.rejects(run('An unknown runtime failure occurred.'), /analysis failed/);
  await assert.rejects(run(advisory + ' Unexpected additional diagnostic.'), /analysis failed/);
  await assert.rejects(run(advisory, 'item.started'), /analysis failed/);
  await assert.rejects(run(advisory, 'turn.failed'), /analysis failed/);
  await assert.rejects(run(advisory, 'item.completed', 'command_execution'), /analysis failed/);
});

async function maintainerReportFixture(t, status) {
  const { MaintainerQueue } = await import('./lib/feedback-maintainer.mjs');
  const f = await fixture(t, async () => ({ ...analysis, reply: '' }));
  const source = await f.send('A real diagnostic issue.');
  const resultDb = join(f.directory, 'maintainer.db');
  const queue = new MaintainerQueue(resultDb, { repository: 'test', topic: 'kommutator-feedback', observerDb: join(f.directory, 'observer.db') });
  t.after(() => queue.close());
  queue.transition({ id: source.id, attempt: 1 }, status, 'Verified and explained.');
  const report = JSON.parse(queue.db.prepare('SELECT data FROM reports').get().data);
  f.observer.resultDb = resultDb;
  return { f, report, resultDb, key: `maintainer-report:${report.id}`, boardKey: `feedback-maintainer/${report.id}` };
}

for (const status of ['queued', 'running', 'answered', 'released', 'blocked']) {
  test(`maintainer ${status} report preserves board/reply replay through restart`, async t => {
    const { f, report, resultDb, key, boardKey } = await maintainerReportFixture(t, status);
    const terminal = ['answered', 'released', 'blocked'].includes(status);
    f.lose('board.put');
    await f.observer.publishMaintainerReports();
    const pending = f.journal.get(key);
    assert.equal(pending.done, false);
    assert.equal(pending.boardDone, false);
    assert.equal(f.replies().length, 0);
    await f.restart(); f.observer.resultDb = resultDb;
    if (terminal) f.lose('message.send');
    await f.observer.publishMaintainerReports();
    assert.equal(f.journal.get(key).boardDone, true);
    assert.equal(f.journal.get(key).done, !terminal);
    await f.restart(); f.observer.resultDb = resultDb;
    await f.observer.publishMaintainerReports();
    await f.observer.publishMaintainerReports();
    assert.deepEqual(f.journal.get(key), { ...pending, boardDone: true, done: true });
    const board = f.db.prepare('SELECT * FROM board_entries WHERE key=?').get(boardKey);
    assert.match(board.body, new RegExp(`Status: ${status}`));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_versions WHERE key=?').get(boardKey).n, 1);
    const replies = f.db.prepare('SELECT * FROM messages WHERE from_session=?').all(f.journal.get('session').id);
    assert.equal(replies.length, terminal ? 1 : 0);
    if (terminal) {
      assert.equal(replies[0].reply_to, report.source);
      assert.equal(replies[0].subject, `Feedback maintainer: ${status}`);
      assert.equal(replies[0].priority, 'fyi');
      assert.equal(replies[0].body, board.body);
    }
    assert.equal(f.journal.get('last_report_error'), null);
  });
}

for (const status of ['queued', 'running']) {
  for (const boardDone of [false, true]) {
    test(`persisted ${status} report with boardDone=${boardDone} completes without a topic reply`, async t => {
      const { f, resultDb, key, boardKey } = await maintainerReportFixture(t, status);
      const saved = { boardOp: randomUUID(), replyKey: randomUUID(), boardDone, done: false };
      if (boardDone) {
        await f.observer.rpc('board.put', { session_id: f.journal.get('session').id,
          topic: 'kommutator-feedback', key: boardKey, body: `Status: ${status}`, op_id: saved.boardOp });
      }
      f.journal.set(key, saved);
      await f.restart(); f.observer.resultDb = resultDb;
      await f.observer.publishMaintainerReports();
      await f.observer.publishMaintainerReports();
      assert.deepEqual(f.journal.get(key), { ...saved, topic: 'kommutator-feedback', boardDone: true, done: true });
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM board_versions WHERE key=?').get(boardKey).n, 1);
      assert.equal(f.replies().length, 0);
      assert.equal(f.journal.get('last_report_error'), null);
    });
  }
}

test('observer backfills exact-key-redacted input for optional maintainer', async t => {
  const f = await fixture(t);
  await f.send('Diagnostic key synthetic-observer-secret-key');
  await f.observer.tick(); await f.observer.tick();
  const job = f.journal.jobs().find(item => item.message?.body.includes('Diagnostic key'));
  assert.ok(job.sanitizedMessage.body.includes('[REDACTED]'));
  assert.ok(!JSON.stringify(job.sanitizedMessage).includes('synthetic-observer-secret-key'));
});

test('optional report failures cannot stop heartbeat and new inbox capture', async t => {
  const f = await fixture(t);
  f.observer.publishMaintainerReports = async () => { throw new Error('protected report'); };
  const sent = await f.send('Another real feedback report.');
  await f.observer.tick();
  assert.ok(f.journal.jobs().some(job => job.id === sent.id));
  assert.ok(f.journal.get('cursor') > 0);
  assert.ok(f.journal.get('last_poll'));
  assert.match(f.journal.get('last_report_error'), /ingestion continues/);
});


test('successful capture clears only its recovered transport error', async t => {
  const f = await fixture(t), request = f.observer.link.request;
  f.observer.link.request = async () => { throw new Error('temporary connection failure'); };
  await f.observer.tick();
  assert.equal(f.journal.get('last_error'), 'hub request failed; pending work retained');
  f.observer.link.request = request;
  await f.observer.tick(); assert.equal(f.journal.get('last_error'), null);
  f.journal.set('last_error', 'analysis unavailable; inspect failed job count or retry later');
  await f.observer.tick(); assert.match(f.journal.get('last_error'), /analysis unavailable/);
});
