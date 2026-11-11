import { cp, mkdir, readFile, rename, rm, stat, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
if (release.format !== 2 || release.nodeVersion !== '26.13.0' || process.versions.node !== release.nodeVersion || !/^[a-f0-9]{64}$/.test(release.id) || !['claude-code', 'codex'].includes(process.argv[2])) throw new Error('Invalid plugin runtime');
if (process.platform !== release.platform || process.arch !== release.arch) throw new Error('Install the plugin artifact for this platform');
if (!release.files || typeof release.files !== 'object' || Array.isArray(release.files) ||
    createHash('sha256').update(JSON.stringify(release.files)).digest('hex') !== release.id ||
    !Object.hasOwn(release.files, 'node') || !Object.hasOwn(release.files, 'ready')) throw new Error('Invalid runtime identity');
async function verify(directory) {
  for (const [path, expected] of Object.entries(release.files)) {
    if (path.split('/').some(part => !part || part === '.' || part === '..') || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid runtime path');
    const file = join(directory, path);
    if (!(await lstat(file)).isFile() || createHash('sha256').update(await readFile(file)).digest('hex') !== expected) throw new Error('Corrupt runtime payload');
  }
}
const home = process.env.KOM_HOME ?? join(homedir(), '.kommutator');
const runtimes = join(home, 'runtimes');
await mkdir(runtimes, { recursive: true, mode: 0o700 });
const target = join(runtimes, release.id);
try { await stat(join(target, 'ready')); }
catch {
  const temporary = join(runtimes, `.install-${randomUUID()}`);
  try {
    await cp(join(root, 'payload'), temporary, { recursive: true, dereference: true });
    await verify(temporary);
    try { await rename(temporary, target); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
await verify(target);
const child = spawn(join(target, 'node'), [join(target, 'app/dist/index.js'), ...(process.argv.length > 3 ? process.argv.slice(3) : ['mcp'])], {
  stdio: 'inherit', env: { ...process.env, KOM_PLUGIN_PROFILE: process.argv[2], KOM_CLAUDE_OWNER_PID: String(process.ppid) },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('kommutator: bundled runtime failed'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
