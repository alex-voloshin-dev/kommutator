#!/usr/bin/env node
// Opt-in Linux/WSL supervisor. No live client or hub changes.
import { mkdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadPolicy, privatePath, MaintainerQueue, FeedbackMaintainer, codexWorker } from './lib/feedback-maintainer.mjs';

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), command = args.shift() ?? 'status';
  if (!['run', '_run', 'status', 'reconcile', '_reconcile'].includes(command)) throw new Error('invalid command');
  const opts = { state: join(homedir(), '.local/state/kommutator-maintainer'), policy: join(homedir(), '.config/kommutator-maintainer/policy.json') };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!['state', 'policy', 'id', 'action', 'note'].includes(key) || !args[index + 1]) throw new Error('invalid option');
    opts[key] = args[index + 1];
  }
  opts.state = resolve(opts.state); opts.policy = resolve(opts.policy);
  await mkdir(opts.state, { recursive: true, mode: 0o700 }); await privatePath(opts.state, true);
  const policy = await loadPolicy(opts.policy, opts.state);
  if (command === 'run' || command === 'reconcile') {
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', '--no-fork', join(opts.state, 'maintainer.lock'),
      process.execPath, fileURLToPath(import.meta.url), `_${command}`, ...args], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => { process.exitCode = code ?? 1; done(); }); });
    return;
  }
  const database = join(opts.state, 'maintainer.db');
  try { await lstat(database); await privatePath(database); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const queue = new MaintainerQueue(database, policy);
  if (command === 'status') {
    console.log(JSON.stringify(queue.jobs().map(({ id, status, attempt, updatedAt, summary }) => ({ id, status, attempt, updatedAt, summary })), null, 2)); queue.close(); return;
  }
  if (command === '_reconcile') { queue.reconcile(opts.id, opts.action, opts.note); queue.close(); return; }
  queue.recover();
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort());
  const maintainer = new FeedbackMaintainer({ queue, policy, worker: codexWorker(policy, opts.state) });
  try {
    while (!controller.signal.aborted) {
      try { await maintainer.tick(controller.signal); } catch { console.error('maintainer: ingestion unavailable; retained queue will be checked again'); }
      if (!controller.signal.aborted) await new Promise(done => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); done(); };
        const timer = setTimeout(finish, 15_000); controller.signal.addEventListener('abort', finish, { once: true });
      });
    }
  } finally { queue.close(); }
}
try { await main(); }
catch { console.error('maintainer: invalid policy/private paths or unavailable dependencies; no work started'); process.exitCode = 1; }
