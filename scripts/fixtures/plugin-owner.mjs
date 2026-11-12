// Synthetic vendor parent: real process ancestry for exported hooks and MCP bootstrap.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { hookDiagnostic } from '../lib/plugin-e2e-diagnostics.mjs';
const plugin = process.argv[2];
const children = new Set();
let stopping = false;
let mcp;
function launch(file, args, options) {
  const child = spawn(join(plugin, 'bin', file), args, options);
  children.add(child);
  child.once('close', () => { children.delete(child); if (stopping && children.size === 0) process.exit(0); });
  return child;
}
process.on('message', async message => {
  try {
    let result;
    if (message.action === 'start') {
      const child = launch('mcp', [], { cwd: '/', env: process.env, stdio: 'inherit' });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      mcp = child;
    } else if (message.action === 'inspect') {
      result = { pid: mcp?.pid, launch_session_id: process.env.CLAUDE_CODE_SESSION_ID };
    } else if (message.action === 'hook') {
      const started = performance.now();
      const child = launch('hook', [message.event], { cwd: '/', env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdoutBytes = 0; let stderrBytes = 0;
      child.stdout.on('data', chunk => { stdoutBytes += chunk.length; });
      child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
      const diagnostic = (outcome, error) => hookDiagnostic({ event: message.event, outcome, elapsed_ms: performance.now() - started,
        exit_code: child.exitCode, signal: child.signalCode, stdout_bytes: stdoutBytes, stderr_bytes: stderrBytes, error_code: error?.code });
      const failure = (outcome, error) => Object.assign(new Error(`Hook fixture ${outcome}`), { diagnostic: diagnostic(outcome, error) });
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = failure('timeout');
          child.kill('SIGKILL');
          reject(error);
        }, 2000);
        child.once('error', error => { clearTimeout(timer); reject(failure('spawn-error', error)); });
        child.stdin.once('error', error => {
          const failed = failure('stdin-error', error);
          clearTimeout(timer); child.kill('SIGKILL'); reject(failed);
        });
        child.once('close', code => {
          clearTimeout(timer);
          code === 0 && stdoutBytes === 0 ? resolve(diagnostic('success')) : reject(failure(code !== 0 ? 'nonzero-exit' : 'unexpected-stdout'));
        });
      });
      child.stdin.end(JSON.stringify(message.payload));
      result = await done;
    } else throw new Error('Unknown owner fixture action');
    process.send({ id: message.id, result });
  } catch (error) { process.send({ id: message.id, error: error.diagnostic ? `Hook fixture ${error.diagnostic.outcome}` : 'Owner fixture action failed', ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) }); }
});
function stop() {
  stopping = true;
  if (children.size === 0) process.exit(0);
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
