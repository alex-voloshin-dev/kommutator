import { readFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { verifyExport } from '../verify-plugin-export.mjs';

// The downloaded checksums are corroborated by the exact cloned source catalogs.
export async function verifyReleaseAssets(clone, directory, version, execute) {
  const prefix = `kommutator-v${version}`;
  const tarName = `${prefix}-linux-x64.tar.gz`, zipName = `${prefix}-claude-linux-x64.zip`;
  const codex = JSON.parse(await readFile(join(clone, 'plugins/hosted/codex/release.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(join(clone, '.claude-plugin/marketplace.json'), 'utf8'));
  const claude = marketplace.plugins?.find(plugin => plugin.name === 'kommutator');
  if (codex.version !== version || codex.platform !== 'linux' || codex.arch !== 'x64' || claude?.version !== version) throw new Error('release catalog version mismatch');
  const assets = join(directory, 'assets');
  await mkdir(assets, { mode: 0o700 });
  for (const [name, entry] of [[tarName, codex], [zipName, claude.source]]) {
    const url = `https://github.com/alex-voloshin-dev/kommutator/releases/download/v${version}/${name}`;
    if (entry?.url !== url || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('release catalog asset mismatch');
    await execute('gh', ['release', 'download', `v${version}`, '--repo', 'alex-voloshin-dev/kommutator', '--pattern', name, '--pattern', `${name}.sha256`, '--dir', assets]);
    if ((await stat(join(assets, name))).size > 268435456 || (await stat(join(assets, `${name}.sha256`))).size > 4096) throw new Error('release asset too large');
    const checksum = (await readFile(join(assets, `${name}.sha256`), 'utf8')).trim();
    if (checksum !== `${entry.sha256}  ${name}` || createHash('sha256').update(await readFile(join(assets, name))).digest('hex') !== entry.sha256) throw new Error('release asset checksum mismatch');
  }
  const unpacked = join(directory, 'verified-export');
  await mkdir(unpacked, { mode: 0o700 });
  // Reject links and special files before extraction; never execute archive members.
  await execute('python3', ['-c', `
import pathlib, sys, tarfile, zipfile, json, hashlib
archive, output, zip_path, version = sys.argv[1:]
with tarfile.open(archive) as tar:
    members = tar.getmembers()
    if len(members) > 20000 or sum(entry.size for entry in members) > 1073741824:
        raise ValueError('Archive too large')
    for entry in members:
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or '..' in path.parts or not (entry.isfile() or entry.isdir()):
            raise ValueError('Unsafe archive member')
    tar.extractall(output, filter='data')
with zipfile.ZipFile(zip_path) as archive:
    release = json.loads(archive.read('runtime/release.json'))
    if release['version'] != version or release['nodeVersion'] != '26.13.0' or release['format'] != 2:
        raise ValueError('ZIP runtime identity mismatch')
    expected = json.loads(pathlib.Path(output, 'plugins/claude-code/runtime/release.json').read_text())
    if release != expected:
        raise ValueError('ZIP/tar runtime identity mismatch')
    for name, digest in release['files'].items():
        if hashlib.sha256(archive.read('runtime/payload/' + name)).hexdigest() != digest:
            raise ValueError('ZIP payload checksum mismatch')
`, join(assets, tarName), unpacked, join(assets, zipName), version]);
  await verifyExport(unpacked, version, await readFile(join(clone, 'LICENSE'), 'utf8'));
  return { tarSha256: codex.sha256, zipSha256: claude.source.sha256 };
}
