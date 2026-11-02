// Explicit, stopped-service migration. No hub history or registration is rewritten.
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdir, rename, open, chmod, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HubLink, Config } from '../../packages/agentd/dist/index.js';
import { Journal, FEEDBACK_TOPIC, LEGACY_FEEDBACK_TOPIC, observerIdentity, observerHost, redact } from './feedback-observer.mjs';
import { MaintainerQueue, maintainerIdentity, loadPolicy, privatePath } from './feedback-maintainer.mjs';

async function durableJson(path, value) {
  const temp = `${path}.${randomUUID()}`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const directory = await open(resolve(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function backup(source, destination) {
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(destination); } finally { db.close(); }
  await chmod(destination, 0o600);
  const file = await open(destination, 'r');
  try { await file.sync(); } finally { await file.close(); }
  const directory = await open(resolve(destination, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
function metadata(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : undefined;
}
function setMetadata(db, key, value) { db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }

export async function captureCutover(config, journal, timeoutMs = 15_000) {
  const session = journal.get('session');
  if (!session?.id || !session.host) throw new Error('existing observer session required');
  const link = new HubLink({ ...config, host: session.host }, () => {});
  let timeout, work, started = false, stopped = false;
  try {
    await Promise.race([
      new Promise((done, reject) => {
        link.start(() => {
          if (started) return;
          started = true;
          work = (async () => {
            await link.request('topic.join', { session_id: session.id, name: FEEDBACK_TOPIC });
            for (let page = 0; page < 100; page++) {
              const result = await link.request('inbox.list', { session_id: session.id, since_seq: journal.get('cursor') ?? 0, unread_only: false, limit: 200 });
              if (stopped) throw new Error('migration capture stopped');
              journal.capture(result.headers, result.cursor);
              if (!result.more) break;
              if (page === 99) throw new Error('mailbox exceeds bounded migration capture');
            }
            // Serving bodies is a normal read receipt; no model processes them during migration.
            for (const job of journal.jobs()) {
              if (!job.message) job.message = (await link.request('message.read', { session_id: session.id, id: job.id })).message;
              if (stopped) throw new Error('migration capture stopped');
              job.sanitizedMessage = { from: redact(job.message.from, config.key), subject: redact(job.message.subject ?? '', config.key), body: redact(job.message.body, config.key) };
              journal.save(job);
            }
          })();
          void work.then(done, reject);
        }, () => {});
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('migration capture timed out')), timeoutMs); }),
    ]);
  } finally { stopped = true; clearTimeout(timeout); await link.close(); await work?.catch(() => {}); }
}

export async function requireNoMaintainer(maintainerState, policyPath) {
  for (const path of [maintainerState, policyPath]) {
    try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('observer-only migration cannot ignore existing maintainer files');
  }
}

export async function migrateFeedbackTopic({ observerState, maintainerState, policyPath, configPath, observerOnly = false, capture = captureCutover, checkpoint = () => {} }) {
  if (observerOnly) await requireNoMaintainer(maintainerState, policyPath);
  for (const directory of observerOnly ? [observerState] : [observerState, maintainerState]) await privatePath(directory, true);
  const observerDb = join(observerState, 'observer.db');
  for (const path of observerOnly ? [configPath, observerDb] : [policyPath, configPath, observerDb, join(maintainerState, 'maintainer.db')]) await privatePath(path);
  const policy = observerOnly ? null : await loadPolicy(policyPath, maintainerState, { allowLegacyTopic: true });
  if (policy && resolve(policy.observerDb) !== resolve(observerDb)) throw new Error('observer path does not match policy');
  const config = Config.parse(JSON.parse(await readFile(configPath, 'utf8')));
  const oldPolicy = { ...policy, topic: LEGACY_FEEDBACK_TOPIC }, newPolicy = { ...policy, topic: FEEDBACK_TOPIC };
  const oldObserver = observerIdentity(config, LEGACY_FEEDBACK_TOPIC), newObserver = observerIdentity(config, FEEDBACK_TOPIC);
  const oldQueue = observerOnly ? null : maintainerIdentity(oldPolicy), newQueue = observerOnly ? null : maintainerIdentity(newPolicy);
  const migrationState = observerOnly ? observerState : maintainerState;
  const markerPath = join(migrationState, 'topic-migration.json');
  let marker;
  try { await privatePath(markerPath); marker = JSON.parse(await readFile(markerPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = new DatabaseSync(observerDb), target = observerOnly ? null : new DatabaseSync(join(maintainerState, 'maintainer.db'));
  try {
    for (const db of [source, target].filter(Boolean)) {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL');
      if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('unsupported journal schema');
    }
    if (observerOnly && source.prepare("SELECT key FROM meta WHERE key LIKE 'maintainer-report:%' LIMIT 1").get()) throw new Error('observer has maintainer publication state; joint migration required');
    const sourceIdentity = metadata(source, 'identity');
    const queueIdentity = target?.prepare("SELECT value FROM meta WHERE key='identity'").get()?.value ?? null;
    if (![oldObserver, newObserver].includes(sourceIdentity) || ![oldQueue, newQueue].includes(queueIdentity)) throw new Error('migration identities do not match');
    if (target?.prepare('SELECT data FROM jobs').all().some(row => JSON.parse(row.data).status === 'running')) throw new Error('wait for the active engineering job to finish');
    const session = metadata(source, 'session');
    if (!session?.id || session.host !== observerHost(config.host, LEGACY_FEEDBACK_TOPIC)) throw new Error('unexpected observer session or host');
    const binding = [oldObserver, newObserver, oldQueue, newQueue, resolve(policyPath), resolve(configPath), resolve(observerState), resolve(maintainerState), session.id, session.host];
    if (marker && (marker.version !== 1 || JSON.stringify(marker.binding) !== JSON.stringify(binding))) throw new Error('migration marker belongs to another configuration');
    if (!marker) {
      if (metadata(source, 'topic_migration_ready') === false) throw new Error('incomplete migration requires its original mode and marker');
      if (sourceIdentity !== oldObserver || queueIdentity !== oldQueue || (policy && policy.topic !== LEGACY_FEEDBACK_TOPIC)) throw new Error('incomplete migration without its recovery marker');
      const directory = join(migrationState, `topic-migration-backup-${randomUUID()}`);
      await mkdir(directory, { mode: 0o700 });
      await backup(observerDb, join(directory, 'observer.db'));
      if (!observerOnly) {
        await backup(join(maintainerState, 'maintainer.db'), join(directory, 'maintainer.db'));
        await durableJson(join(directory, 'policy.json'), JSON.parse(await readFile(policyPath, 'utf8')));
      }
      marker = { version: 1, binding, backup: directory, captured: false, complete: false };
      await durableJson(markerPath, marker); await checkpoint('prepared');
    }
    if (marker.complete || metadata(source, 'topic_migration_ready') === true) {
      if (sourceIdentity !== newObserver || queueIdentity !== newQueue || (policy && policy.topic !== FEEDBACK_TOPIC)) throw new Error('completed migration state is inconsistent');
      if (target) setMetadata(target, 'topic_migration_ready', true);
      marker.complete = true; await durableJson(markerPath, marker);
      return { topic: FEEDBACK_TOPIC, backup: marker.backup, replayed: true };
    }
    setMetadata(source, 'topic_migration_ready', false);
    if (target) setMetadata(target, 'topic_migration_ready', false);
    if (!marker.captured) {
      const journal = new Journal(observerDb, sourceIdentity, { allowMigration: true });
      try { await capture(config, journal); } finally { journal.close(); }
      marker.captured = true; await durableJson(markerPath, marker); await checkpoint('captured');
    }
    source.exec('BEGIN IMMEDIATE');
    try {
      const legacyJobIds = [];
      for (const row of source.prepare('SELECT id,data FROM jobs').all()) {
        const job = JSON.parse(row.data);
        if (!job.message) throw new Error('captured job has no body');
        const newOnly = job.message.to.includes(`topic:${FEEDBACK_TOPIC}`) && !job.message.to.includes(`topic:${LEGACY_FEEDBACK_TOPIC}`);
        job.topic ??= newOnly ? FEEDBACK_TOPIC : LEGACY_FEEDBACK_TOPIC;
        if (job.topic === LEGACY_FEEDBACK_TOPIC) legacyJobIds.push(job.id);
        if (newOnly && job.stage === 'ignored') { job.stage = 'pending'; job.nextAt = 0; }
        source.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), row.id);
      }
      setMetadata(source, 'topic_migration', { from: LEGACY_FEEDBACK_TOPIC, to: FEEDBACK_TOPIC, legacyJobIds });
      setMetadata(source, 'retained_host', session.host);
      setMetadata(source, 'identity', newObserver);
      for (const row of source.prepare("SELECT key,value FROM meta WHERE key LIKE 'maintainer-report:%'").all()) {
        const value = JSON.parse(row.value); value.topic ??= LEGACY_FEEDBACK_TOPIC; setMetadata(source, row.key, value);
      }
      source.exec('COMMIT');
    } catch (error) { source.exec('ROLLBACK'); throw error; }
    await checkpoint('observer');
    if (!observerOnly) {
      // Import historic completed sources before switching the queue policy. Import is ID-deduplicated.
      const queue = new MaintainerQueue(join(maintainerState, 'maintainer.db'), queueIdentity === oldQueue ? oldPolicy : newPolicy, { allowMigration: true });
      try { queue.import(oldPolicy); } finally { queue.close(); }
      target.exec('BEGIN IMMEDIATE');
      try {
        for (const row of target.prepare('SELECT id,data FROM reports').all()) {
          const report = JSON.parse(row.data); report.topic ??= LEGACY_FEEDBACK_TOPIC;
          target.prepare('UPDATE reports SET data=? WHERE id=?').run(JSON.stringify(report), row.id);
        }
        target.prepare("UPDATE meta SET value=? WHERE key='identity'").run(newQueue);
        target.exec('COMMIT');
      } catch (error) { target.exec('ROLLBACK'); throw error; }
      await checkpoint('queue');
      await durableJson(policyPath, newPolicy); await checkpoint('policy');
    }
    setMetadata(source, 'topic_migration_ready', true);
    if (target) setMetadata(target, 'topic_migration_ready', true);
    await checkpoint('ready');
    marker.complete = true; await durableJson(markerPath, marker);
    return { topic: FEEDBACK_TOPIC, backup: marker.backup, replayed: false };
  } finally { source.close(); target?.close(); }
}
