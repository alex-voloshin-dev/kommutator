// Synthetic vendor parent: real process ancestry for exported hooks and MCP bootstrap.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
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
      const child = launch('hook', [message.event], { cwd: '/', env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const done = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Hook fixture timed out')); }, 2000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => {
          clearTimeout(timer);
          code === 0 && stdout === '' ? resolve() : reject(new Error(`Hook failed (${code}): ${stdout} ${stderr}`));
        });
      });
      child.stdin.end(JSON.stringify(message.payload));
      await done;
    } else throw new Error('Unknown owner fixture action');
    process.send({ id: message.id, result });
  } catch (error) { process.send({ id: message.id, error: error.message }); }
});
function stop() {
  stopping = true;
  if (children.size === 0) process.exit(0);
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
