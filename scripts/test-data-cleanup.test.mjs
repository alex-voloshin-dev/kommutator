import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConformanceHarness } from '../packages/hub/dist/testing.js';
import { openDatabase } from '../packages/hub/dist/db.js';
import { createHubServer } from '../packages/hub/dist/server.js';
import { cleanupTestData, inspectCleanup, validateManifest } from './lib/test-data-cleanup.mjs';
const require = createRequire(new URL('../packages/hub/package.json', import.meta.url));
const WebSocket = require('ws');

async function fixture(t, isolated = false) {
  const dir = await mkdtemp(join(tmpdir(), 'kom-cleanup-')); await chmod(dir, 0o700);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const h = createConformanceHarness(), peer = h.connect('fixture');
  const testPeer = isolated ? h.connect('isolated') : peer;
  const registration = { op: 'register', session: { host: isolated ? 'isolated' : 'fixture', name: 'test', vendor: 'other', ...(isolated ? { project_key: 'test-project' } : {}) }, reg_id: 'test-registration' };
  const gone = testPeer.request('session.upsert', registration).session;
  const owner = peer.request('session.upsert', { op: 'register', reg_id: 'real-registration', session: { host: 'fixture', vendor: 'other', name: 'real' } }).session;
  const send = { session_id: owner.id, idempotency_key: 'test-message', message: { from: '', to: [gone.handle], body: 'synthetic payload', kind: 'dm' } };
  const message = peer.request('message.send', send);
  const topic = isolated ? 'project:test-project' : 'global';
  const topicId = h.db.prepare('SELECT id FROM topics WHERE name=?').get(topic).id;
  const board = { session_id: isolated ? gone.id : owner.id, topic, key: 'synthetic-board', body: 'synthetic board', op_id: 'test-board' };
  (isolated ? testPeer : peer).request('board.put', board);
  testPeer.request('session.gone', { session_id: gone.id, incarnation: gone.incarnation });
  const database = join(dir, 'hub.db'); h.db.prepare('VACUUM INTO ?').run(database); h.close(); await chmod(database, 0o600);
  const manifest = { version: 1, reason: 'Explicit synthetic fixture', sessions: [gone.id], messages: [message.id], topics: isolated ? [topicId] : [], hosts: isolated ? ['isolated'] : [], boards: [{ topic_id: topicId, key: board.key }] };
  return { database, manifest, registration, send, board, owner, gone, backupPath: join(dir, 'before.db'), dir };
}
function query(path, sql) { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare(sql).all(); } finally { db.close(); } }
async function apply(f) { const plan = await cleanupTestData(f); f.manifest.expected_sha256 = plan.fingerprint; return cleanupTestData({ ...f, apply: true, hubStopped: true }); }

async function connect(t, database) {
  const db = openDatabase(database), server = createHubServer({ db, key: 'synthetic-cleanup-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`, { headers: { Authorization: 'Bearer synthetic-cleanup-key' } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  t.after(async () => { ws.terminate(); await new Promise(resolve => server.close(resolve)); db.close(); });
  let serial = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => reject(new Error('RPC timeout')), 2000);
    ws.once('message', raw => { clearTimeout(timer); const reply = JSON.parse(raw); assert.equal(reply.id, id); resolve(reply); });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
  await call('hello', { host: 'fixture', agentd_version: 'test', protocol_version: 1 });
  return call;
}

test('dry run is nonmutating; apply deletes exact closure, keeps real owner/counters, backs up and replays', async t => {
  const f = await fixture(t), before = query(f.database, 'SELECT * FROM sessions');
  const dry = await cleanupTestData(f); assert.equal(dry.applied, false); assert.equal(dry.counts.messages, 1);
  assert.deepEqual(query(f.database, 'SELECT * FROM sessions'), before);
  const result = await apply(f); assert.equal(result.applied, true); assert.equal(result.replayed, false);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 0);
  assert.equal(query(f.database, 'SELECT * FROM sessions').length, 1);
  assert.deepEqual(query(f.database, 'SELECT * FROM sessions')[0], before.find(row => row.id === f.owner.id));
  assert.equal(query(f.backupPath, 'SELECT * FROM messages').length, 1); assert.equal((await stat(f.backupPath)).mode & 0o777, 0o600);
  assert.equal(query(f.database, 'SELECT * FROM retired_operations').length, 4);
  const replay = await cleanupTestData({ ...f, apply: true, hubStopped: true }); assert.equal(replay.replayed, true); assert.equal(replay.counts.messages, 0);
  const changed = { ...f.manifest, reason: 'different review' };
  await assert.rejects(cleanupTestData({ ...f, manifest: changed, apply: true, hubStopped: true }), /missing/);
});

test('lost-ACK retries of retired registration, message and board keys cannot recreate data', async t => {
  const f = await fixture(t); await apply(f);
  const call = await connect(t, f.database);
  for (const [method, params] of [['session.upsert', f.registration], ['message.send', f.send], ['board.put', f.board]]) {
    const response = await call(method, params); assert.equal(response.error?.code, -32009); assert.match(response.error.message, /permanently removed/);
  }
  assert.equal(query(f.database, 'SELECT * FROM sessions').length, 1);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 0);
  assert.equal(query(f.database, 'SELECT * FROM board_entries').length, 0);
  assert.equal(query(f.database, 'SELECT * FROM deliveries').length, 0);
});

test('schema 5 upgrades additively and idempotently; unknown versions remain refused', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.database);
  db.exec('DROP TABLE retired_operations; PRAGMA user_version=5'); const before = db.prepare('SELECT * FROM messages').all(); db.close();
  const upgraded = openDatabase(f.database); assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(upgraded.prepare('SELECT * FROM messages').all(), before); upgraded.close();
  openDatabase(f.database).close();
  const unknown = new DatabaseSync(f.database); unknown.exec('PRAGMA user_version=4'); unknown.close();
  assert.throws(() => openDatabase(f.database), /supports only/);
});

test('fingerprint changes, active sessions, omitted reference closure and protected boards refuse before mutation', async t => {
  const f = await fixture(t), dry = await cleanupTestData(f); f.manifest.expected_sha256 = dry.fingerprint;
  const db = new DatabaseSync(f.database);
  db.prepare('UPDATE messages SET body=?').run('changed synthetic body');
  await assert.rejects(cleanupTestData({ ...f, apply: true, hubStopped: true }), /changed since/);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 1);
  await assert.rejects(stat(f.backupPath), { code: 'ENOENT' });
  db.prepare('UPDATE sessions SET ended_at=NULL,state=? WHERE id=?').run('active', f.gone.id);
  assert.throws(() => inspectCleanup(db, f.manifest), /active/);
  db.prepare('UPDATE sessions SET ended_at=?,state=? WHERE id=?').run('2026-01-01', 'gone', f.gone.id);
  assert.throws(() => inspectCleanup(db, { ...f.manifest, messages: [] }), /retained deliveries/);
  db.exec('UPDATE board_entries SET protected=1'); assert.throws(() => inspectCleanup(db, f.manifest), /protected/); db.close();
});

test('shared host/global topic and retained replies cannot be swept into a test cleanup', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.database);
  assert.throws(() => inspectCleanup(db, { ...f.manifest, hosts: ['fixture'] }), /retained sessions/);
  assert.throws(() => inspectCleanup(db, { ...f.manifest, topics: [1] }), /global/);
  const message = db.prepare('SELECT * FROM messages').get();
  db.prepare(`INSERT INTO messages SELECT 'retained-reply','retained-key',from_session,from_handle,kind,priority,subject,body,thread_id,id,hops,origin,force_wake,created_at FROM messages WHERE id=?`).run(message.id);
  assert.throws(() => inspectCleanup(db, f.manifest), /retained thread/); db.close();
});

test('completed replay refuses recreated primary data and unsafe manifest/path inputs', async t => {
  const f = await fixture(t); await apply(f);
  const db = new DatabaseSync(f.database);
  db.prepare("INSERT INTO board_entries(topic_id,key,body,author,updated_at) VALUES(1,?,'real replacement','real','now')").run(f.board.key);db.close();
  await assert.rejects(cleanupTestData({ ...f, apply: true, hubStopped: true }), /recreated/);
  assert.throws(() => validateManifest({ ...f.manifest, messages: [7] }), /invalid messages/);
  assert.throws(() => validateManifest({ ...f.manifest, sessions: [...f.manifest.sessions, ...f.manifest.sessions] }), /duplicate/);
  assert.throws(() => validateManifest({ ...f.manifest, unexpected: true }), /unknown/);
  await assert.rejects(cleanupTestData({ ...f, apply: true, hubStopped: false }), /hub-stopped/);
  await chmod(f.database, 0o644); await assert.rejects(cleanupTestData(f), /private owned/);
});

test('closed isolated host/project closure is removed while global and real subscriber survive', async t => {
  const f = await fixture(t, true); const result = await apply(f);
  assert.equal(result.counts.hosts, 1); assert.equal(result.counts.topics, 1);
  assert.deepEqual(query(f.database, 'SELECT name FROM hosts').map(row => row.name), ['fixture']);
  assert.deepEqual(query(f.database, 'SELECT name FROM topics').map(row => row.name), ['global']);
  assert.deepEqual(query(f.database, 'SELECT session_id FROM memberships').map(row => row.session_id), [f.owner.id]);
  assert.deepEqual(query(f.database, 'PRAGMA foreign_key_check'), []);
});

test('dry run does not migrate an old database and apply never overwrites a backup', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.database);
  db.exec('DROP TABLE retired_operations; PRAGMA user_version=5'); db.close();
  await assert.rejects(cleanupTestData(f), /already upgraded/);
  assert.equal(query(f.database, 'PRAGMA user_version')[0].user_version, 5);
  openDatabase(f.database).close();
  const plan = await cleanupTestData(f); f.manifest.expected_sha256 = plan.fingerprint;
  const saved = new DatabaseSync(f.backupPath); saved.exec('CREATE TABLE sentinel(value TEXT)'); saved.close();
  await assert.rejects(cleanupTestData({ ...f, apply: true, hubStopped: true }), /backup already exists/);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 1);
  assert.deepEqual(query(f.backupPath, 'SELECT * FROM sentinel'), []);
});

const cliPath = fileURLToPath(new URL('./cleanup-test-data.mjs', import.meta.url));
function cli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: '/', encoding: 'utf8', timeout: 5000 });
}

test('actual CLI defaults to dry-run, requires explicit apply acknowledgement, and completes a replay-safe cleanup', async t => {
  const f = await fixture(t), manifestPath = join(f.dir, 'reviewed.json');
  await writeFile(manifestPath, JSON.stringify(f.manifest), { mode: 0o600 });
  const args = ['--db', f.database, '--manifest', manifestPath];
  const dry = cli(args); assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout); assert.equal(plan.applied, false);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 1);
  await assert.rejects(stat(f.backupPath), { code: 'ENOENT' });
  f.manifest.expected_sha256 = plan.fingerprint;
  await writeFile(manifestPath, JSON.stringify(f.manifest));
  const refused = cli([...args, '--apply', '--backup', f.backupPath]);
  assert.equal(refused.status, 1); assert.match(refused.stderr, /hub-stopped/);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 1);
  const applyArgs = [...args, '--apply', '--hub-stopped', '--backup', f.backupPath];
  const applied = cli(applyArgs); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).applied, true);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 0);
  const replay = cli(applyArgs); assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replayed, true);
});

test('CLI rejects malformed, public and symlinked manifests without leaking private JSON content', async t => {
  const f = await fixture(t), path = join(f.dir, 'manifest.json'), alias = join(f.dir, 'alias.json');
  const privateMarker = 'synthetic-private-manifest-marker';
  await writeFile(path, `{"reason":"${privateMarker}", BROKEN`, { mode: 0o600 });
  let result = cli(['--db', f.database, '--manifest', path]);
  assert.equal(result.status, 1); assert.match(result.stderr, /Invalid cleanup manifest JSON/);
  assert(!`${result.stdout}${result.stderr}`.includes(privateMarker));
  await writeFile(path, JSON.stringify(f.manifest)); await chmod(path, 0o644);
  result = cli(['--db', f.database, '--manifest', path]);
  assert.equal(result.status, 1); assert.match(result.stderr, /private bounded manifest/);
  await chmod(path, 0o600); await symlink(path, alias);
  result = cli(['--db', f.database, '--manifest', alias]);
  assert.equal(result.status, 1); assert.match(result.stderr, /private bounded manifest/);
  assert.equal(query(f.database, 'SELECT * FROM messages').length, 1);
});

test('a deletion failure rolls back earlier payload removals and all retired keys while retaining a usable backup', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.database);
  db.exec("CREATE TRIGGER fail_selected_board BEFORE DELETE ON board_entries BEGIN SELECT RAISE(ABORT, 'synthetic delete failure'); END"); db.close();
  const watched = ['messages', 'message_targets', 'deliveries', 'sessions', 'memberships', 'session_registrations', 'board_entries', 'board_versions', 'retired_operations'];
  const before = Object.fromEntries(watched.map(table => [table, query(f.database, `SELECT * FROM ${table}`)]));
  await assert.rejects(apply(f), /synthetic delete failure/);
  for (const table of watched) assert.deepEqual(query(f.database, `SELECT * FROM ${table}`), before[table], `${table} must roll back`);
  assert.deepEqual(query(f.backupPath, 'SELECT * FROM messages'), before.messages);
  assert.deepEqual(query(f.database, 'PRAGMA foreign_key_check'), []);
});

test('unrelated real messages, receipts and board history remain byte-for-byte unchanged', async t => {
  const f = await fixture(t), db = new DatabaseSync(f.database);
  db.prepare(`INSERT INTO messages SELECT 'real-message','real-message-key',from_session,from_handle,kind,priority,'Real work','Keep this body','real-message',NULL,hops,origin,force_wake,created_at FROM messages`).run();
  db.prepare("INSERT INTO message_targets VALUES('real-message','session',?)").run(f.owner.id);
  db.prepare("INSERT INTO deliveries VALUES('real-message',?,1,'read',0,'2026-11-01')").run(f.owner.id);
  db.prepare('UPDATE sessions SET next_seq=2 WHERE id=?').run(f.owner.id);
  db.prepare("INSERT INTO board_entries VALUES(1,'real-board','Real board content',2,?,1,'2026-11-01')").run(f.owner.handle);
  for (const version of [1, 2]) db.prepare("INSERT INTO board_versions VALUES(1,'real-board',?,'Real version',?,?,1,?,'2026-11-01')").run(version, f.owner.handle, f.owner.id, `real-board-op-${version}`);
  db.close();
  const queries = {
    message: "SELECT * FROM messages WHERE id='real-message'",
    targets: "SELECT * FROM message_targets WHERE message_id='real-message'",
    receipts: "SELECT * FROM deliveries WHERE message_id='real-message'",
    board: "SELECT * FROM board_entries WHERE key='real-board'",
    history: "SELECT * FROM board_versions WHERE key='real-board' ORDER BY version",
    owner: "SELECT * FROM sessions WHERE name='real'",
    registration: "SELECT * FROM session_registrations WHERE reg_id='real-registration'",
  };
  const before = Object.fromEntries(Object.entries(queries).map(([key, sql]) => [key, query(f.database, sql)]));
  await apply(f);
  for (const [key, sql] of Object.entries(queries)) assert.deepEqual(query(f.database, sql), before[key], key);
  assert.equal(query(f.database, 'SELECT count(*) AS count FROM messages')[0].count, 1);
  assert.deepEqual(query(f.database, 'PRAGMA foreign_key_check'), []);
});
