import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('hex');
async function filesAt(directory, prefix = '') {
  const result = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await filesAt(join(directory, entry.name), name + '/'));
    else if (entry.isFile()) result[name] = hash(await readFile(join(directory, entry.name)));
    else throw new Error(`Unexpected non-file in export: ${name}`);
  }
  return result;
}
export async function verifyExport(artifact, version, license) {
  const actual = await filesAt(artifact);
  delete actual.SHA256SUMS;
  const expected = {};
  for (const line of (await readFile(join(artifact, 'SHA256SUMS'), 'utf8')).trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert(match, 'Malformed checksum line');
    assert(!Object.hasOwn(expected, match[2]), 'Duplicate checksum path');
    expected[match[2]] = match[1];
  }
  assert.deepEqual(actual, expected, 'Export checksum inventory differs');
  for (const vendor of ['claude-code', 'codex']) {
    const directory = join(artifact, 'plugins', vendor);
    const release = JSON.parse(await readFile(join(directory, 'runtime/release.json'), 'utf8'));
    assert.equal(release.version, version, 'Release version differs');
    assert.equal(release.nodeVersion, '26.13.0', 'Runtime Node version differs');
    assert.equal(release.format, 2, 'Runtime format differs');
    assert.equal(release.platform, 'linux'); assert.equal(release.arch, 'x64');
    const payload = join(directory, 'runtime/payload');
    const files = await filesAt(payload);
    assert.deepEqual(release.files, files, 'Runtime checksums differ');
    assert.equal(release.id, hash(JSON.stringify(files)), 'Runtime content identity differs');
    const manifest = JSON.parse(await readFile(join(directory, vendor === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.version, version, 'Plugin version differs');
    for (const path of [join(directory, 'LICENSE'), join(payload, 'LICENSE')]) assert.equal(await readFile(path, 'utf8'), license, 'Project license differs');
    assert((await readFile(join(payload, 'NODE-LICENSE'), 'utf8')).length > 100, 'Node notice missing');
    assert((await readdir(join(payload, 'THIRD-PARTY-LICENSES'))).length > 0, 'Dependency notices missing');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = new URL('../', import.meta.url);
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  await verifyExport(resolve(process.argv[2]), version, await readFile(new URL('LICENSE', root), 'utf8'));
  console.log('Export checksums, release identities and license notices verified (linux-x64)');
}
