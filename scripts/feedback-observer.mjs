#!/usr/bin/env node
// Linux/WSL operator entrypoint. Not loaded by the hub or client plugins.
import { mkdir, chmod, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HubLink, Config } from '../packages/agentd/dist/index.js';
import { Methods } from '../packages/protocol/dist/index.js';
import { Journal, FeedbackObserver, codexAnalyzer, observerHost, observerIdentity } from './lib/feedback-observer.mjs';

function options(argv) {
  const result = { command: argv[0] ?? 'status', stateDir: join(homedir(), '.local/state/kommutator-feedback'),
    config: join(process.env.KOM_HOME ?? join(homedir(), '.kommutator'), 'config.json'),
    topic: 'kommutator-feedback', pollMs: 15_000, cooldownMs: 60_000, timeoutMs: 180_000 };
  if (!['run', '_worker', 'status', 'retry'].includes(result.command)) throw new Error('invalid command');
  const flags = { '--result-db': 'resultDb', '--state-dir': 'stateDir', '--config': 'config', '--topic': 'topic', '--codex': 'codex', '--model': 'model', '--effort': 'effort', '--poll-ms': 'pollMs', '--cooldown-ms': 'cooldownMs', '--timeout-ms': 'timeoutMs' };
  for (let index = 1; index < argv.length; index += 2) {
    const key = flags[argv[index]], value = argv[index + 1];
    if (!key || !value || value.length > 1024) throw new Error('invalid option');
    result[key] = key.endsWith('Ms') ? Number(value) : value;
  }
  for (const [key, min, max] of [['pollMs', 1000, 60_000], ['cooldownMs', 1000, 3600_000], ['timeoutMs', 1000, 600_000]]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error('invalid duration');
  }
  Methods['topic.join'].parse({ session_id: 'validation', name: result.topic });
  result.config = resolve(result.config); result.stateDir = resolve(result.stateDir);
  return result;
}

async function main() {
  process.umask(0o077);
  const opts = options(process.argv.slice(2));
  await mkdir(opts.stateDir, { recursive: true, mode: 0o700 });
  const directory = await lstat(opts.stateDir);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid()) throw new Error('unsafe state directory');
  await chmod(opts.stateDir, 0o700);
  if (opts.command === 'run') {
    // flock is a kernel-owned lock, released after crashes; a PID file is not sufficient.
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', '--no-fork', join(opts.stateDir, 'observer.lock'),
      process.execPath, fileURLToPath(import.meta.url), '_worker', ...process.argv.slice(3)], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    await new Promise((resolveRun, reject) => {
      child.once('error', reject);
      child.once('close', code => { process.exitCode = code ?? 1; resolveRun(); });
    });
    return;
  }
  const raw = await readFile(opts.config, 'utf8');
  const config = Config.parse(JSON.parse(raw));
  const identity = observerIdentity(config, opts.topic);
  const journalPath = join(opts.stateDir, 'observer.db');
  try {
    const existing = await lstat(journalPath);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid()) throw new Error('unsafe journal');
    await chmod(journalPath, 0o600);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const journal = new Journal(journalPath, identity);
  const host = journal.get('retained_host') ?? observerHost(config.host, opts.topic);
  if (journal.get('retained_host') && host !== journal.get('session')?.host) throw new Error('retained observer host mismatch');
  if (opts.command === 'status') { console.log(JSON.stringify(journal.status(), null, 2)); journal.close(); return; }
  if (opts.command === 'retry') {
    let retried = 0;
    for (const job of journal.jobs()) if (job.stage === 'failed') { job.stage = 'pending'; job.attempts = 0; job.nextAt = 0; journal.save(job); retried++; }
    console.log(JSON.stringify({ retried })); journal.close(); return;
  }
  const link = new HubLink({ ...config, host }, () => console.error('feedback observer: hub disconnected; reconnecting'));
  const observer = new FeedbackObserver({ link, journal, host, topic: opts.topic, key: config.key,
    analyze: codexAnalyzer(opts), resultDb: opts.resultDb, cooldownMs: opts.cooldownMs });
  let closing = false;
  const timer = setInterval(() => { void observer.tick().catch(() => console.error('feedback observer: processing failed; journal retained')); }, opts.pollMs);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    if (closing) return; closing = true; clearInterval(timer);
    void observer.close().finally(() => journal.close()).catch(() => { process.exitCode = 1; });
  });
  link.start(() => observer.connect(), () => { /* Polling journal is authoritative; notifications are optional hints. */ });
}
try { await main(); }
catch { console.error('feedback observer: unable to start; check configuration, private paths and installed dependencies'); process.exitCode = 1; }
