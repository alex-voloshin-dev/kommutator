import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyExport } from './verify-plugin-export.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const license = 'MIT fixture license';
async function inventory(root, prefix = '') {
  const files = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) Object.assign(files, await inventory(join(root, entry.name), prefix + entry.name + '/'));
    else if (entry.name !== 'SHA256SUMS') files[prefix + entry.name] = hash(await readFile(join(root, entry.name)));
  }
  return files;
}
async function checksums(root) {
  await writeFile(join(root, 'SHA256SUMS'), Object.entries(await inventory(root)).map(([path, digest]) => `${digest}  ${path}\n`).join(''));
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kom-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const vendor of ['claude-code', 'codex']) {
    const directory = join(root, 'plugins', vendor);
    const payload = join(directory, 'runtime/payload');
    await mkdir(join(payload, 'THIRD-PARTY-LICENSES'), { recursive: true });
    await writeFile(join(payload, 'THIRD-PARTY-LICENSES/fixture'), 'dependency notice');
    await writeFile(join(payload, 'NODE-LICENSE'), 'Node license fixture '.repeat(20));
    await writeFile(join(payload, 'LICENSE'), license);
    await writeFile(join(directory, 'LICENSE'), license);
    const files = await inventory(payload);
    await writeFile(join(directory, 'runtime/release.json'), JSON.stringify({ version: '1.2.3', platform: 'linux', arch: 'x64', files, id: hash(JSON.stringify(files)) }));
    const manifest = join(directory, vendor === 'codex' ? '.codex-plugin' : '.claude-plugin');
    await mkdir(manifest);
    await writeFile(join(manifest, 'plugin.json'), JSON.stringify({ version: '1.2.3' }));
  }
  await checksums(root);
  return root;
}
test('accepts matching release, content identity, complete inventory and notices', async t => {
  await verifyExport(await fixture(t), '1.2.3', license);
});
test('rejects unlisted files and tampered content', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'unexpected'), 'extra');
  await assert.rejects(verifyExport(root, '1.2.3', license), /checksum inventory/);
  await rm(join(root, 'unexpected'));
  await writeFile(join(root, 'plugins/codex/LICENSE'), 'changed');
  await assert.rejects(verifyExport(root, '1.2.3', license), /checksum inventory/);
});
test('rejects incorrect project license even with updated checksums', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'plugins/codex/LICENSE'), 'wrong');
  await checksums(root);
  await assert.rejects(verifyExport(root, '1.2.3', license), /Project license differs/);
});
test('rejects stale release version and invalid runtime identity', async t => {
  const root = await fixture(t);
  await assert.rejects(verifyExport(root, '2.0.0', license), /Release version differs/);
  const path = join(root, 'plugins/codex/runtime/release.json');
  const release = JSON.parse(await readFile(path, 'utf8')); release.id = '0'.repeat(64);
  await writeFile(path, JSON.stringify(release)); await checksums(root);
  await assert.rejects(verifyExport(root, '1.2.3', license), /Runtime content identity/);
});
test('rejects missing dependency notices despite updated release identity and checksums', async t => {
  const root = await fixture(t);
  const directory = join(root, 'plugins/codex/runtime');
  await rm(join(directory, 'payload/THIRD-PARTY-LICENSES/fixture'));
  const releasePath = join(directory, 'release.json');
  const release = JSON.parse(await readFile(releasePath, 'utf8'));
  release.files = await inventory(join(directory, 'payload'));
  release.id = hash(JSON.stringify(release.files));
  await writeFile(releasePath, JSON.stringify(release));
  await checksums(root);
  await assert.rejects(verifyExport(root, '1.2.3', license), /Dependency notices missing/);
});
test('rejects malformed and duplicate checksum entries', async t => {
  const root = await fixture(t);
  const path = join(root, 'SHA256SUMS');
  const original = await readFile(path, 'utf8');
  await writeFile(path, 'invalid checksum\n');
  await assert.rejects(verifyExport(root, '1.2.3', license), /Malformed checksum line/);
  await writeFile(path, original + original.split('\n')[0] + '\n');
  await assert.rejects(verifyExport(root, '1.2.3', license), /Duplicate checksum path/);
});
