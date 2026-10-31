import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeHostedPlugins } from './lib/hosted-plugin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv.length !== 4) throw new Error('Usage: node scripts/package-client-release.mjs <verified-export> <fresh-output-directory>');
const artifact = await realpath(resolve(process.argv[2]));
const out = resolve(process.argv[3]);
if (out === artifact || out.startsWith(artifact + '/')) throw new Error('Release output must be outside the artifact');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be x.y.z');
const identity = JSON.parse(await readFile(join(artifact, 'plugins/codex/runtime/release.json'), 'utf8'));
if (identity.version !== version || identity.platform !== 'linux' || identity.arch !== 'x64') throw new Error('Release artifact must match package version and Linux x64 target');
execFileSync(process.execPath, [join(root, 'scripts/verify-plugin-export.mjs'), artifact], { stdio: 'inherit' });
await mkdir(out); // Refuse to overwrite any previous release staging directory.
const name = `kommutator-v${version}-linux-x64.tar.gz`;
const archive = join(out, name);
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', artifact, '.']);
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(join(out, name + '.sha256'), `${sha256}  ${name}\n`);
const release = { version, platform: 'linux', arch: 'x64', url: `https://github.com/alex-voloshin-dev/kommutator/releases/download/v${version}/${name}`, sha256 };
// Claude downloads and verifies its archive during plugin installation, outside the
// MCP startup deadline. Preserve executable bits in the Unix ZIP attributes.
const zipName = `kommutator-v${version}-claude-linux-x64.zip`;
const zipPath = join(out, zipName);
execFileSync('python3', ['-c', `
import os, stat, sys, zipfile
root, output = sys.argv[1:]
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
  for directory, dirs, files in os.walk(root):
    dirs.sort()
    for name in sorted(files):
      path = os.path.join(directory, name)
      info = zipfile.ZipInfo(os.path.relpath(path, root).replace(os.sep, '/'), (1980, 1, 1, 0, 0, 0))
      info.create_system = 3
      info.external_attr = (os.stat(path).st_mode & 0xffff) << 16
      info.compress_type = zipfile.ZIP_DEFLATED
      with open(path, 'rb') as source:
        archive.writestr(info, source.read(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
`, join(artifact, 'plugins/claude-code'), zipPath]);
const zipHash = createHash('sha256').update(await readFile(zipPath)).digest('hex');
await writeFile(join(out, zipName + '.sha256'), `${zipHash}  ${zipName}\n`);
await writeHostedPlugins(root, release, { url: `https://github.com/alex-voloshin-dev/kommutator/releases/download/v${version}/${zipName}`, sha256: zipHash });
console.log(`Prepared ${archive}; hosted catalogs pin SHA256 ${sha256}. Publish this exact archive before the catalogs.`);
