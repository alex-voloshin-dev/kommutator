#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadDeployPolicy, readCheckpoint, saveCheckpoint, updateOnce, run, cutoverConstraints } from './lib/local-release-deploy.mjs';

async function main() {
  process.umask(0o077);
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '26.13.0') throw new Error('Linux x64 Node 26.13.0 required');
  const args = process.argv.slice(2), command = args.shift() ?? 'status';
  if (!['run', '_run', 'cutover', '_cutover', 'status', 'reconcile', '_reconcile'].includes(command)) throw new Error('invalid command');
  const isCutover = command === 'cutover' || command === '_cutover';
  const expected = isCutover ? cutoverConstraints(args) : undefined;
  if (['run', '_run', 'status'].includes(command) && args.length) throw new Error('unexpected arguments');
  const state = join(homedir(), '.local/state/kommutator-release-deploy'), path = join(homedir(), '.config/kommutator-release-deploy/policy.json');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const policy = await loadDeployPolicy(path, state);
  if (command === 'run' || command === 'cutover' || command === 'reconcile') {
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', '--no-fork', join(state, 'update.lock'), process.execPath, fileURLToPath(import.meta.url), `_${command}`, ...args], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { process.exitCode = code ?? 1; resolve(); }); }); return;
  }
  if (command === '_run' || command === '_cutover') {
    const controller = new AbortController();
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort());
    console.log(JSON.stringify(await updateOnce({ policy, state, mode: isCutover ? 'cutover' : 'run', expected, execute: (cmd, argv, opts) => run(cmd, argv, { ...opts, signal: controller.signal }) }), null, 2)); return;
  }
  const checkpoint = await readCheckpoint(state, policy.baselineVersion);
  if (command === '_reconcile') {
    const [action, note] = args;
    if (!['retry', 'accept'].includes(action) || !note?.trim() || note.length > 2000 || args.length !== 2 || checkpoint.status !== 'blocked') throw new Error('reconcile requires blocked state, retry|accept and inspection note');
    if (action === 'accept') checkpoint.appliedVersion = checkpoint.targetVersion;
    checkpoint.status = 'idle'; checkpoint.reconciliation = note; delete checkpoint.error; await saveCheckpoint(state, checkpoint);
  }
  console.log(JSON.stringify(checkpoint, null, 2));
}
try { await main(); } catch { console.error('local release update unavailable: inspect policy, dependencies and retained private logs'); process.exitCode = 1; }
