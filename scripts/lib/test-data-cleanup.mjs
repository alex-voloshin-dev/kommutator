// Explicit operator cleanup. This module never guesses which data is a test.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmod, lstat, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const tables = ['sessions', 'messages', 'topics', 'hosts', 'memberships', 'message_targets', 'deliveries', 'board_entries', 'board_versions', 'session_registrations'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/u.test(value);
const boardId = value => JSON.stringify([value.topic_id, value.key]);
const sorted = rows => rows.sort((a, b) => {
  const left = JSON.stringify(a), right = JSON.stringify(b);
  return left < right ? -1 : left > right ? 1 : 0;
});
function receiptKey(manifest, fingerprint = manifest.expected_sha256) {
  const { expected_sha256, ...selection } = manifest;
  return `${fingerprint}:${createHash('sha256').update(JSON.stringify(selection)).digest('hex')}`;
}

export function validateManifest(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be an object');
  assert(Object.keys(input).every(key => ['version', 'reason', 'sessions', 'messages', 'topics', 'hosts', 'boards', 'expected_sha256'].includes(key)), 'unknown manifest field');
  assert(input.version === 1 && identifier(input.reason), 'manifest requires version 1 and a reason');
  for (const key of ['sessions', 'messages', 'topics', 'hosts', 'boards']) {
    assert(Array.isArray(input[key]) && input[key].length <= 5000, `invalid ${key} selection`);
    const values = input[key];
    if (key === 'topics') assert(values.every(value => Number.isSafeInteger(value) && value > 0), 'invalid topic ID');
    else if (key === 'boards') assert(values.every(value => value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === 2 && Number.isSafeInteger(value.topic_id) && value.topic_id > 0 && identifier(value.key)), 'invalid board selector');
    else assert(values.every(identifier), `invalid ${key} ID`);
    assert(new Set(values.map(value => JSON.stringify(value))).size === values.length, `duplicate ${key} selection`);
  }
  assert(['sessions', 'messages', 'topics', 'hosts', 'boards'].some(key => input[key].length > 0), 'empty cleanup selection');
  assert(input.expected_sha256 === undefined || /^[a-f0-9]{64}$/.test(input.expected_sha256), 'invalid expected fingerprint');
  return { version: 1, reason: input.reason, sessions: [...input.sessions].sort(), messages: [...input.messages].sort(),
    topics: [...input.topics].sort((a, b) => a - b), hosts: [...input.hosts].sort(), boards: sorted([...input.boards]),
    ...(input.expected_sha256 === undefined ? {} : { expected_sha256: input.expected_sha256 }) };
}

function readRows(db) {
  const rows = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all()]));
  assert(Object.values(rows).every(value => value.length <= 100000), 'database exceeds bounded cleanup inspection; use a dedicated maintenance plan');
  return rows;
}
function primarySelection(rows, manifest) {
  const sessions = new Set(manifest.sessions), messages = new Set(manifest.messages), topics = new Set(manifest.topics), hosts = new Set(manifest.hosts), boards = new Set(manifest.boards.map(boardId));
  return {
    sessions: rows.sessions.filter(row => sessions.has(row.id)), messages: rows.messages.filter(row => messages.has(row.id)),
    topics: rows.topics.filter(row => topics.has(row.id)), hosts: rows.hosts.filter(row => hosts.has(row.name)),
    board_entries: rows.board_entries.filter(row => boards.has(boardId(row))),
  };
}
export function inspectCleanup(db, input) {
  const manifest = validateManifest(input);
  assert(db.prepare('PRAGMA user_version').get().user_version === 6, 'cleanup requires a hub already upgraded to schema 6');
  assert(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'database has foreign-key violations');
  const rows = readRows(db), selected = primarySelection(rows, manifest);
  if (manifest.expected_sha256 && db.prepare("SELECT 1 FROM retired_operations WHERE kind='cleanup' AND operation_key=?").get(receiptKey(manifest))) {
    assert(Object.values(selected).every(value => value.length === 0), 'completed cleanup IDs now refer to records; refusing to delete recreated data');
    return { manifest, replayed: true, fingerprint: manifest.expected_sha256, counts: Object.fromEntries(tables.map(table => [table, 0])) };
  }
  for (const [table, key] of [['sessions', 'sessions'], ['messages', 'messages'], ['topics', 'topics'], ['hosts', 'hosts'], ['board_entries', 'boards']]) {
    assert(selected[table].length === manifest[key].length, `selected ${key} missing; review manifest again`);
  }
  const sessionIds = new Set(manifest.sessions), messageIds = new Set(manifest.messages), topicIds = new Set(manifest.topics), hostNames = new Set(manifest.hosts), boardKeys = new Set(manifest.boards.map(boardId));
  const handles = new Set(selected.sessions.map(row => row.handle));
  const topicNames = new Set(selected.topics.map(row => row.name));
  assert(selected.sessions.every(row => row.ended_at !== null && row.state === 'gone'), 'active or uncertain session selected');
  assert(selected.topics.every(row => row.name !== 'global' && row.kind !== 'global'), 'global topic cannot be removed');
  assert(selected.board_entries.every(row => row.protected === 0), 'protected board selected');
  assert(rows.sessions.every(row => !hostNames.has(row.host) || sessionIds.has(row.id)), 'host contains retained sessions');
  assert(rows.sessions.every(row => !topicNames.has(`project:${row.project_key}`) || sessionIds.has(row.id)), 'project topic belongs to a retained session');
  assert(rows.messages.every(row => !sessionIds.has(row.from_session) || messageIds.has(row.id)), 'session authored retained messages');
  assert(rows.messages.every(row => messageIds.has(row.id) || (!messageIds.has(row.thread_id) && !messageIds.has(row.reply_to))), 'message has retained thread or reply references');
  assert(rows.deliveries.every(row => !sessionIds.has(row.session_id) || messageIds.has(row.message_id)), 'session has retained deliveries');
  assert(rows.message_targets.every(row => messageIds.has(row.message_id) || !(row.target_type === 'topic' && topicNames.has(row.target_id))
    && !(row.target_type === 'session' && (sessionIds.has(row.target_id) || handles.has(row.target_id)))), 'retained message targets selected topic or session');
  assert(rows.memberships.every(row => !topicIds.has(row.topic_id) || sessionIds.has(row.session_id)), 'topic has retained subscribers');
  assert(rows.board_entries.every(row => !topicIds.has(row.topic_id) && !handles.has(row.author) || boardKeys.has(boardId(row))), 'retained board references selected topic or session');
  assert(rows.board_versions.every(row => !topicIds.has(row.topic_id) && !sessionIds.has(row.author_session) && !handles.has(row.author) || boardKeys.has(boardId(row))), 'retained board history references selected topic or session');
  selected.memberships = rows.memberships.filter(row => sessionIds.has(row.session_id));
  selected.message_targets = rows.message_targets.filter(row => messageIds.has(row.message_id));
  selected.deliveries = rows.deliveries.filter(row => messageIds.has(row.message_id));
  selected.board_versions = rows.board_versions.filter(row => boardKeys.has(boardId(row)));
  assert(selected.board_versions.every(row => row.protected === 0), 'protected board history selected');
  selected.session_registrations = rows.session_registrations.filter(row => sessionIds.has(row.session_id));
  const { expected_sha256, ...selection } = manifest;
  const snapshot = Object.fromEntries(tables.map(table => [table, sorted(selected[table])]));
  const fingerprint = createHash('sha256').update(JSON.stringify({ selection, snapshot })).digest('hex');
  const counts = Object.fromEntries(tables.map(table => [table, snapshot[table].length]));
  return { manifest, replayed: false, fingerprint, counts, snapshot };
}

async function privateFile(path, directory = false) {
  const info = await lstat(path);
  assert(!info.isSymbolicLink() && (directory ? info.isDirectory() : info.isFile()) && info.uid === process.getuid() && !(info.mode & 0o077), 'private owned path required');
}
export async function cleanupTestData({ database, manifest: input, apply = false, hubStopped = false, backupPath }) {
  const manifest = validateManifest(input);
  await privateFile(database);
  assert(!apply || (hubStopped === true && manifest.expected_sha256 && typeof backupPath === 'string'), 'apply requires --hub-stopped, reviewed fingerprint and backup path');
  const db = new DatabaseSync(database, { readOnly: !apply });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    const plan = inspectCleanup(db, manifest);
    const summary = { fingerprint: plan.fingerprint, counts: plan.counts, replayed: plan.replayed, applied: false };
    if (!apply || plan.replayed) return { ...summary, applied: apply && plan.replayed };
    assert(manifest.expected_sha256 === plan.fingerprint, 'database changed since reviewed dry run');
    assert(resolve(backupPath) !== resolve(database), 'backup must be a new file');
    await privateFile(dirname(resolve(backupPath)), true);
    try { await lstat(backupPath); throw new Error('backup already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    db.prepare('VACUUM INTO ?').run(resolve(backupPath));
    await chmod(backupPath, 0o600);
    const backup = await open(backupPath, 'r'); try { await backup.sync(); } finally { await backup.close(); }
    const directory = await open(dirname(resolve(backupPath)), 'r'); try { await directory.sync(); } finally { await directory.close(); }
    db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    try {
      const locked = inspectCleanup(db, manifest);
      assert(!locked.replayed && locked.fingerprint === plan.fingerprint, 'database changed while backing up');
      const retire = db.prepare('INSERT INTO retired_operations(kind,operation_key) VALUES (?,?)');
      for (const row of locked.snapshot.messages) retire.run('message', row.idempotency_key);
      for (const row of locked.snapshot.session_registrations) retire.run('registration', row.reg_id);
      for (const row of locked.snapshot.board_versions) retire.run('board', row.op_id);
      for (const id of manifest.messages) {
        db.prepare('DELETE FROM deliveries WHERE message_id=?').run(id);
        db.prepare('DELETE FROM message_targets WHERE message_id=?').run(id);
        db.prepare('DELETE FROM messages WHERE id=?').run(id);
      }
      for (const row of manifest.boards) {
        db.prepare('DELETE FROM board_versions WHERE topic_id=? AND key=?').run(row.topic_id, row.key);
        db.prepare('DELETE FROM board_entries WHERE topic_id=? AND key=?').run(row.topic_id, row.key);
      }
      for (const id of manifest.sessions) {
        db.prepare('DELETE FROM memberships WHERE session_id=?').run(id);
        db.prepare('DELETE FROM session_registrations WHERE session_id=?').run(id);
        db.prepare('DELETE FROM sessions WHERE id=?').run(id);
      }
      for (const id of manifest.topics) db.prepare('DELETE FROM topics WHERE id=?').run(id);
      for (const name of manifest.hosts) db.prepare('DELETE FROM hosts WHERE name=?').run(name);
      retire.run('cleanup', receiptKey(manifest, plan.fingerprint));
      assert(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'cleanup would violate foreign keys');
      db.exec('COMMIT');
      return { ...summary, applied: true, backup: resolve(backupPath) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
