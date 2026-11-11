import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { verifyReleaseAssets } from './lib/release-assets.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
async function inventory(directory, prefix = '') {
  const files = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await inventory(join(directory, entry.name), name + '/'));
    else files[name] = hash(await readFile(join(directory, entry.name)));
  }
  return files;
}
async function fixture(t, mutate = '') {
  const root = await mkdtemp(join(tmpdir(), 'kom-assets-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const clone = join(root, 'repo'), artifact = join(root, 'export'), upstream = join(root, 'upstream'), attempt = join(root, 'attempt');
  for (const path of [clone, artifact, upstream, attempt]) await mkdir(path);
  const license = 'MIT License fixture'; await writeFile(join(clone, 'LICENSE'), license);
  for (const vendor of ['claude-code', 'codex']) {
    const directory = join(artifact, 'plugins', vendor), payload = join(directory, 'runtime/payload');
    await mkdir(join(payload, 'THIRD-PARTY-LICENSES'), { recursive: true });
    await writeFile(join(payload, 'LICENSE'), license); await writeFile(join(directory, 'LICENSE'), license);
    await writeFile(join(payload, 'NODE-LICENSE'), 'Node license '.repeat(20));
    await writeFile(join(payload, 'THIRD-PARTY-LICENSES/notice'), 'dependency license');
    await writeFile(join(payload, 'node'), 'fixture node, never executed');
    const files = await inventory(payload);
    await writeFile(join(directory, 'runtime/release.json'), JSON.stringify({ version: '0.12.0', platform: 'linux', arch: 'x64', nodeVersion: mutate === 'runtime' ? '24.22.1' : '26.13.0', format: 2, files, id: hash(JSON.stringify(files)) }));
    const manifest = join(directory, vendor === 'codex' ? '.codex-plugin' : '.claude-plugin'); await mkdir(manifest);
    await writeFile(join(manifest, 'plugin.json'), JSON.stringify({ version: '0.12.0' }));
  }
  await writeFile(join(artifact, 'SHA256SUMS'), Object.entries(await inventory(artifact)).map(([path, digest]) => `${digest}  ${path}\n`).join(''));
  const tarName = 'kommutator-v0.12.0-linux-x64.tar.gz', zipName = 'kommutator-v0.12.0-claude-linux-x64.zip';
  execFileSync('python3', ['-c', `
import tarfile, zipfile, pathlib, sys, io
root, upstream, tar_name, zip_name, mutate = sys.argv[1:]
with tarfile.open(pathlib.Path(upstream, tar_name), 'w:gz') as tar:
    tar.add(root, arcname='.')
    if mutate in ('traversal', 'symlink'):
        info = tarfile.TarInfo('../escape' if mutate == 'traversal' else 'linked')
        if mutate == 'symlink': info.type, info.linkname = tarfile.SYMTYPE, '/tmp/outside'
        tar.addfile(info, io.BytesIO(b''))
with zipfile.ZipFile(pathlib.Path(upstream, zip_name), 'w') as archive:
    directory = pathlib.Path(root, 'plugins/claude-code')
    for path in directory.rglob('*'):
        if path.is_file():
            name = str(path.relative_to(directory))
            if mutate == 'zip-payload' and name == 'runtime/payload/node': archive.writestr(name, b'corrupted runtime')
            else: archive.write(path, name)
`, artifact, upstream, tarName, zipName, mutate]);
  const record = async name => {
    const sha256 = hash(await readFile(join(upstream, name)));
    await writeFile(join(upstream, name + '.sha256'), `${sha256}  ${name}\n`);
    return { url: `https://github.com/alex-voloshin-dev/kommutator/releases/download/v0.12.0/${name}`, sha256 };
  };
  const tar = await record(tarName), zip = await record(zipName);
  await mkdir(join(clone, 'plugins/hosted/codex'), { recursive: true }); await mkdir(join(clone, '.claude-plugin'));
  await writeFile(join(clone, 'plugins/hosted/codex/release.json'), JSON.stringify({ version: '0.12.0', platform: 'linux', arch: 'x64', ...tar }));
  await writeFile(join(clone, '.claude-plugin/marketplace.json'), JSON.stringify({ plugins: [{ name: 'kommutator', version: '0.12.0', source: zip }] }));
  const execute = async (command, args) => {
    if (command === 'gh') {
      assert.equal(args[0], 'release'); assert.equal(args[2], 'v0.12.0');
      for (let i = 0; i < args.length; i++) if (args[i] === '--pattern') await cp(join(upstream, args[i + 1]), join(args.at(-1), args[i + 1]));
      if (mutate === 'checksum') await writeFile(join(args.at(-1), args[args.indexOf('--pattern') + 1]), 'tampered');
      if (mutate === 'zip-checksum' && args.includes(zipName)) await writeFile(join(args.at(-1), zipName), 'tampered');
      if (mutate === 'zip-sidecar' && args.includes(zipName)) await writeFile(join(args.at(-1), zipName + '.sha256'), `${zip.sha256}  unrelated.zip\n`);
      return '';
    }
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  return { clone, attempt, execute, tar, zip, root };
}
test('verified downloaded archives match source catalogs and both internal payloads', async t => {
  const f = await fixture(t); assert.deepEqual(await verifyReleaseAssets(f.clone, f.attempt, '0.12.0', f.execute), { tarSha256: f.tar.sha256, zipSha256: f.zip.sha256 });
});
for (const mutate of ['checksum', 'zip-checksum', 'zip-sidecar', 'zip-payload', 'traversal', 'symlink', 'runtime']) test(`rejects ${mutate} before deployment`, async t => {
  const f = await fixture(t, mutate); await assert.rejects(verifyReleaseAssets(f.clone, f.attempt, '0.12.0', f.execute));
  await assert.rejects(readFile(join(f.root, 'escape')), { code: 'ENOENT' });
});
test('catalog mismatch rejects download before network execution', async t => {
  const f = await fixture(t);
  await assert.rejects(verifyReleaseAssets(f.clone, f.attempt, '0.13.0', async () => assert.fail('must not download')), /catalog version mismatch/);
});
