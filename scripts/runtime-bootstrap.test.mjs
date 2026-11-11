import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kom-bootstrap-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime'), home = join(root, 'home'); await mkdir(join(runtime, 'payload/app/dist'), { recursive: true });
  const files = {};
  for (const [name, body] of [['node', '#!/bin/sh\nprintf "verified-runtime\\n"\n'], ['ready', 'kommutator plugin runtime 2\n'], ['app/dist/index.js', 'fixture']]) {
    await writeFile(join(runtime, 'payload', name), body, { mode: name === 'node' ? 0o755 : 0o644 }); files[name] = hash(body);
  }
  const release = { version: '0.12.0', platform: process.platform, arch: process.arch, nodeVersion: '26.13.0', format: 2, files, id: hash(JSON.stringify(files)) };
  await writeFile(join(runtime, 'release.json'), JSON.stringify(release)); await cp(new URL('../plugins/runtime/bootstrap.mjs', import.meta.url), join(runtime, 'bootstrap.mjs'));
  const run = () => spawnSync(process.execPath, [join(runtime, 'bootstrap.mjs'), 'codex'], { env: { ...process.env, KOM_HOME: home }, encoding: 'utf8' });
  return { runtime, home, release, run };
}
test('cold and warm runtime bootstrap validate payload, then reject corrupted warm cache', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) { const result = f.run(); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'verified-runtime\n'); }
  await writeFile(join(f.home, 'runtimes', f.release.id, 'app/dist/index.js'), 'corruption');
  const result = f.run(); assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); assert.match(result.stderr, /Corrupt runtime payload/);
});
test('cold corruption and mixed runtime metadata cannot launch the child', async t => {
  const f = await fixture(t); await writeFile(join(f.runtime, 'payload/node'), 'corruption');
  let result = f.run(); assert.notEqual(result.status, 0); assert.equal(result.stdout, '');
  f.release.nodeVersion = '24.22.1'; await writeFile(join(f.runtime, 'release.json'), JSON.stringify(f.release));
  result = f.run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid plugin runtime/);
  await assert.rejects(readFile(join(f.home, 'runtimes', f.release.id, 'ready')), { code: 'ENOENT' });
});
