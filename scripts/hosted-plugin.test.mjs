import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { launcher } from './lib/hosted-plugin.mjs';
const url = 'https://github.com/alex-voloshin-dev/kommutator/releases/download/v0.2.0/kommutator-v0.2.0-linux-x64.tar.gz';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kom-hosted-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const artifact = join(directory, 'artifact');
  for (const vendor of ['claude-code', 'codex']) {
    const base = join(artifact, 'plugins', vendor);
    await mkdir(join(base, 'bin'), { recursive: true });
    await mkdir(join(base, 'runtime/payload'), { recursive: true });
    for (const [name, code] of Object.entries({ 'bin/mcp': '#!/bin/sh\nprintf \'{"fixture":"' + vendor + '"}\\n\'\n', 'bin/hook': '#!/bin/sh\nexit 0\n', 'bin/manage': '#!/bin/sh\nprintf \'managed\\n\'\n', 'runtime/payload/node': '#!/bin/sh\nexit 0\n' })) {
      await writeFile(join(base, name), code, { mode: 0o755 });
    }
  }
  const archive = join(directory, 'client.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', artifact, '.']);
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'curl'), `#!/bin/sh
printf 'download\\n' >> "$MOCK_COUNT"
[ "\${MOCK_FAIL:-}" != yes ] || exit 22
while [ "$#" -gt 0 ]; do
 if [ "$1" = --output ]; then shift; output=$1; fi
 shift
done
cp "$MOCK_ARCHIVE" "$output"
`, { mode: 0o755 });
  const env = { ...process.env, HOME: directory, KOM_HOME: join(directory, '.kommutator'), PATH: `${bin}:/usr/bin:/bin`, MOCK_ARCHIVE: archive, MOCK_COUNT: join(directory, 'count') };
  const file = join(directory, 'launch');
  await writeFile(file, launcher({ vendor: 'codex', url, sha256 }), { mode: 0o755 });
  function run(args = ['mcp'], changes = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { env: { ...env, ...changes } });
      let stdout = '', stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
  }
  return { directory, env, file, sha256, run };
}
test('first MCP startup downloads once, validates, and works offline afterwards', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.run(), { code: 0, stdout: '{"fixture":"codex"}\n', stderr: 'kommutator: downloading verified Linux x64 client once...\n' });
  assert.deepEqual(await f.run(['mcp'], { MOCK_FAIL: 'yes' }), { code: 0, stdout: '{"fixture":"codex"}\n', stderr: '' });
  assert.equal(await readFile(f.env.MOCK_COUNT, 'utf8'), 'download\n');
  assert.equal((await f.run(['manage', 'status'])).stdout, 'managed\n');
});
test('hooks never download or install; cold hooks and invalid state paths fail open', async t => {
  const f = await fixture(t);
  const start = performance.now();
  assert.deepEqual(await f.run(['hook', 'SessionStart']), { code: 0, stdout: '', stderr: '' });
  assert.ok(performance.now() - start < 200);
  await assert.rejects(readFile(f.env.MOCK_COUNT), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.env.KOM_HOME, 'downloads')), { code: 'ENOENT' });
  assert.deepEqual(await f.run(['hook', 'Stop'], { KOM_HOME: 'relative' }), { code: 0, stdout: '', stderr: '' });
});
test('concurrent MCP starts share one atomically installed client', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.run(), f.run(), f.run()]);
  for (const r of results) { assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout, '{"fixture":"codex"}\n'); }
  assert.equal(await readFile(f.env.MOCK_COUNT, 'utf8'), 'download\n');
});
test('wrong checksum cannot execute or leave a ready cache, retry recovers', async t => {
  const f = await fixture(t);
  const bad = join(f.directory, 'bad.tar.gz');
  await writeFile(bad, 'untrusted network content');
  const r = await f.run(['mcp'], { MOCK_ARCHIVE: bad });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /checksum mismatch/);
  await assert.rejects(readFile(join(f.env.KOM_HOME, 'downloads', f.sha256, 'ready')), { code: 'ENOENT' });
  assert.equal((await f.run()).code, 0);
});
test('network failure remains stderr-only and does not create a ready cache', async t => {
  const f = await fixture(t);
  const r = await f.run(['mcp'], { MOCK_FAIL: 'yes' });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Client download failed/);
  await assert.rejects(readFile(join(f.env.KOM_HOME, 'downloads', f.sha256, 'ready')), { code: 'ENOENT' });
});
test('symlink state and lock paths are refused without downloads', async t => {
  const f = await fixture(t);
  const other = join(f.directory, 'other');
  await mkdir(other);
  await symlink(other, f.env.KOM_HOME);
  assert.match((await f.run()).stderr, /symbolic link/);
  await rm(f.env.KOM_HOME);
  await mkdir(join(f.env.KOM_HOME, 'downloads'), { recursive: true });
  await symlink(join(f.directory, 'victim'), join(f.env.KOM_HOME, 'downloads', f.sha256 + '.lock'));
  assert.match((await f.run()).stderr, /Unsafe cache lock/);
  await assert.rejects(readFile(f.env.MOCK_COUNT), { code: 'ENOENT' });
});
test('cache with loosened permissions is refused', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  await chmod(join(f.env.KOM_HOME, 'downloads', f.sha256), 0o755);
  const r = await f.run();
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unsafe cached release permissions/);
});
test('hosted manifest renderer rejects arbitrary download hosts and malformed identities', () => {
  assert.throws(() => launcher({ vendor: 'codex', url: 'https://evil.example/client.tar.gz', sha256: 'a'.repeat(64) }));
  assert.throws(() => launcher({ vendor: 'codex', url, sha256: 'not-a-checksum' }));
  assert.throws(() => launcher({ vendor: 'unknown', url, sha256: 'a'.repeat(64) }));
});
test('unsupported platform gives an actionable MCP error before network access', async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, 'bin/uname'), '#!/bin/sh\nprintf \'Darwin\\n\'\n', { mode: 0o755 });
  const r = await f.run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Linux x64 \/ WSL2 Ubuntu x64 only/);
  await assert.rejects(readFile(f.env.MOCK_COUNT), { code: 'ENOENT' });
});
test('warm hook executes locally without network and refuses unsafe cache permissions', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  assert.deepEqual(await f.run(['hook', 'Stop'], { MOCK_FAIL: 'yes' }), { code: 0, stdout: '', stderr: '' });
  await chmod(join(f.env.KOM_HOME, 'downloads', f.sha256), 0o755);
  assert.deepEqual(await f.run(['hook', 'Stop']), { code: 0, stdout: '', stderr: '' });
  assert.equal(await readFile(f.env.MOCK_COUNT, 'utf8'), 'download\n');
});
test('private state paths with spaces work without shell splitting', async t => {
  const f = await fixture(t);
  const changes = { KOM_HOME: join(f.directory, 'private state with spaces') };
  const first = await f.run(['mcp'], changes);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, '{"fixture":"codex"}\n');
  const warm = await f.run(['mcp'], { ...changes, MOCK_FAIL: 'yes' });
  assert.equal(warm.code, 0, warm.stderr);
  assert.equal(warm.stdout, first.stdout);
  assert.equal(await readFile(f.env.MOCK_COUNT, 'utf8'), 'download\n');
});
test('a FIFO cache lock is rejected before opening or downloading', async t => {
  const f = await fixture(t);
  const cache = join(f.env.KOM_HOME, 'downloads');
  await mkdir(cache, { recursive: true });
  execFileSync('mkfifo', [join(cache, f.sha256 + '.lock')]);
  const r = await f.run();
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Unsafe cache lock/);
  await assert.rejects(readFile(f.env.MOCK_COUNT), { code: 'ENOENT' });
});
