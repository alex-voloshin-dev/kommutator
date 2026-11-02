#!/usr/bin/env node
// Requires both services stopped; flock prevents racing their active journals.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { migrateFeedbackTopic, requireNoMaintainer } from './lib/feedback-topic-migration.mjs';
import { privatePath } from './lib/feedback-maintainer.mjs';
async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), command = args.shift();
  if (!['apply', '_apply', 'apply-observer-only', '_apply-observer-only'].includes(command)) throw new Error('use apply after stopping both services');
  const options = { observerState: join(homedir(), '.local/state/kommutator-feedback'), maintainerState: join(homedir(), '.local/state/kommutator-maintainer'), policyPath: join(homedir(), '.config/kommutator-maintainer/policy.json'), configPath: join(homedir(), '.kommutator/config.json') };
  const flags = { '--observer-state': 'observerState', '--maintainer-state': 'maintainerState', '--policy': 'policyPath', '--config': 'configPath' };
  for (let i = 0; i < args.length; i += 2) { const key = flags[args[i]]; if (!key || !args[i + 1]) throw new Error('invalid option'); options[key] = resolve(args[i + 1]); }
  options.observerOnly = command.endsWith('observer-only');
  if (command === 'apply' || command === 'apply-observer-only') {
    await privatePath(options.observerState, true);
    if (options.observerOnly) await requireNoMaintainer(options.maintainerState, options.policyPath);
    else await privatePath(options.maintainerState, true);
    const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '75', '--no-fork', join(options.observerState, 'observer.lock'), ...(options.observerOnly ? [] : ['flock', '--nonblock', '--conflict-exit-code', '75', '--no-fork', join(options.maintainerState, 'maintainer.lock')]), process.execPath, fileURLToPath(import.meta.url), `_${command}`, ...args], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => { process.exitCode = code ?? 1; done(); }); });
  } else console.log(JSON.stringify(await migrateFeedbackTopic(options), null, 2));
}
try { await main(); } catch { console.error('Feedback topic migration stopped: verify private paths, matching configuration and stopped services. Keep services stopped; inspect private backups and rerun the same command to resume.'); process.exitCode = 1; }
