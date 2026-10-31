import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('./hub.sh', import.meta.url));
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'kom-hub-helper-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'docker'), `#!/bin/sh
if [ "$*" = 'compose version' ]; then exit 0; fi
case "$*" in
  *'ps --all --quiet hub') printf '%s' "\${FAKE_CONTAINER:-}"; exit "\${FAKE_DOCKER_EXIT:-0}" ;;
  inspect*) printf '%s' "\${FAKE_INSPECT:-}"; exit 0 ;;
esac
printf '%s\\n' "$*" >> "$HOME/docker-calls"
printf '%s\\n' "$KOM_UID:$KOM_GID|$KOM_PUBLISH_HOST:$KOM_PUBLISH_PORT|$KOM_KEY_FILE|$KOM_DATA_DIR" >> "$HOME/docker-env"
exit "\${FAKE_DOCKER_EXIT:-0}"
`, { mode: 0o700 });
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  for (const key of Object.keys(env)) if (key.startsWith('KOM_') || key.startsWith('COMPOSE_')) delete env[key];
  return { home, bin, env, key: join(home, '.config/kommutator-hub/hub.key'), data: join(home, '.local/share/kommutator-hub'), run: (action, extra = {}) => exec('sh', [script, action], { env: { ...env, ...extra }, cwd: '/' }) };
}
test('setup creates private state without starting Docker; repeated setup preserves key and data', async t => {
  const f = await fixture(t);
  const first = await f.run('setup');
  const key = await readFile(f.key, 'utf8');
  assert.match(key, /^[a-f0-9]{64}\n$/);
  assert.ok(!first.stdout.includes(key.trim()));
  assert.equal((await stat(f.key)).mode & 0o777, 0o600);
  assert.equal((await stat(f.data)).mode & 0o777, 0o700);
  await writeFile(join(f.data, 'kommutator.db'), 'existing data');
  await f.run('setup');
  assert.equal(await readFile(f.key, 'utf8'), key);
  assert.equal(await readFile(join(f.data, 'kommutator.db'), 'utf8'), 'existing data');
  await assert.rejects(readFile(join(f.home, 'docker-calls')), { code: 'ENOENT' });
});
test('concurrent setup uses one persistent key and leaves no temporary files', async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, () => f.run('setup')));
  assert.match(await readFile(f.key, 'utf8'), /^[a-f0-9]{64}\n$/);
  assert.deepEqual((await readdir(join(f.home, '.config/kommutator-hub'))).sort(), ['helper.lock', 'hub.key']);
});
test('up, status, logs, backup and down pin paths and identity in fresh shells and preserve state', async t => {
  const f = await fixture(t);
  await f.run('up');
  const key = await readFile(f.key, 'utf8');
  for (const action of ['status', 'logs', 'backup', 'down']) await f.run(action);
  const calls = await readFile(join(f.home, 'docker-calls'), 'utf8');
  assert.match(calls, /--env-file \/dev\/null -f .*\/compose.yaml up -d --build --wait --no-recreate hub/);
  assert.match(calls, /ps --all hub/);
  assert.match(calls, /logs --tail 50 hub/);
  assert.match(calls, /exec -T hub node \/app\/container\/backup.mjs \/data\/backup-[\w-]+\.db/);
  assert.match(calls, / down\n/);
  const environments = (await readFile(join(f.home, 'docker-env'), 'utf8')).trim().split('\n');
  assert.equal(new Set(environments).size, 1);
  assert.equal(environments[0], `${process.getuid()}:${process.getgid()}|127.0.0.1:8787|${f.key}|${f.data}`);
  assert.equal(await readFile(f.key, 'utf8'), key);
  assert.ok((await stat(f.data)).isDirectory());
});
test('Docker failure propagates without rotating key or claiming readiness', async t => {
  const f = await fixture(t);
  await f.run('setup');
  const key = await readFile(f.key, 'utf8');
  await assert.rejects(f.run('up', { FAKE_DOCKER_EXIT: '42' }), error => error.code === 42 && !error.stdout.includes('Hub is ready'));
  assert.equal(await readFile(f.key, 'utf8'), key);
});
test('failed key generation leaves no installed key or temporary file', async t => {
  const f = await fixture(t);
  await writeFile(join(f.bin, 'openssl'), '#!/bin/sh\nprintf broken\nexit 1\n', { mode: 0o700 });
  await assert.rejects(f.run('setup'), /Key generation failed/);
  assert.deepEqual(await readdir(join(f.home, '.config/kommutator-hub')), ['helper.lock']);
});
test('existing invalid key is refused and never replaced', async t => {
  const f = await fixture(t);
  await f.run('setup');
  await writeFile(f.key, '');
  await assert.rejects(f.run('up'), /key missing or unsafe/);
  assert.equal(await readFile(f.key, 'utf8'), '');
});
test('symlink key is refused without changing target', async t => {
  const f = await fixture(t);
  await f.run('setup');
  await rm(f.key);
  const target = join(f.home, 'target');
  await writeFile(target, 'unchanged', { mode: 0o644 });
  await symlink(target, f.key);
  await assert.rejects(f.run('setup'), /key missing or unsafe/);
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
  assert.equal((await stat(target)).mode & 0o777, 0o644);
});
test('custom or LAN environment is refused before state creation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run('up', { KOM_PUBLISH_HOST: '0.0.0.0' }), /Unset KOM_PUBLISH_HOST/);
  await assert.rejects(stat(f.data), { code: 'ENOENT' });
});
test('unknown action fails without state changes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run('upgrade'), /Unknown command/);
  await assert.rejects(stat(f.data), { code: 'ENOENT' });
});

test('refuses to modify a same-named hub with different mounts or LAN settings', async t => {
  const f = await fixture(t);
  await f.run('setup');
  const key = await readFile(f.key, 'utf8');
  for (const action of ['up', 'down', 'backup']) {
    await assert.rejects(f.run(action, { FAKE_CONTAINER: 'existing-container', FAKE_INSPECT: 'other-settings' }), /Existing hub uses different settings/);
  }
  await assert.rejects(readFile(join(f.home, 'docker-calls')), { code: 'ENOENT' });
  assert.equal(await readFile(f.key, 'utf8'), key);
});
test('accepts an existing default hub without recreating its container', async t => {
  const f = await fixture(t);
  await f.run('setup');
  await f.run('up', { FAKE_CONTAINER: 'existing-container', FAKE_INSPECT: `${process.getuid()}:${process.getgid()}|${f.data}|${f.key}|127.0.0.1:8787` });
  assert.match(await readFile(join(f.home, 'docker-calls'), 'utf8'), /--no-recreate hub/);
});
