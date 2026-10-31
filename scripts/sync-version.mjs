import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid root release version');
const check = process.argv.includes('--check');
const manifests = (await readdir(resolve(root, 'packages'))).map(name => `packages/${name}/package.json`);
manifests.push('plugins/claude-code/.claude-plugin/plugin.json');
for (const name of manifests) {
  const path = resolve(root, name);
  const source = await readFile(path, 'utf8');
  const manifest = JSON.parse(source);
  if (manifest.version === version) continue;
  if (check) throw new Error(`Release version differs: ${name}; run pnpm version:sync`);
  await writeFile(path, source.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`));
}
const path = resolve(root, 'packages/protocol/src/release.ts');
const content = `// Generated from root package.json by pnpm version:sync.\nexport const RELEASE_VERSION = ${JSON.stringify(version)};\n`;
let previous; try { previous = await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous !== content) {
  if (check) throw new Error('Generated release version differs; run pnpm version:sync');
  await writeFile(path, content);
}
