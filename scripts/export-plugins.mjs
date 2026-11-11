import { cp, realpath, mkdir, readFile, writeFile, readdir, chmod, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const out = resolve(process.argv[2] ?? '/tmp/kommutator-plugins');
const node = resolve(process.env.KOM_EXPORT_NODE ?? process.execPath);
let license = process.env.KOM_EXPORT_NODE_LICENSE;
if (!license) {
  for (const candidate of [resolve(dirname(node), '../LICENSE'), '/usr/share/doc/nodejs/LICENSE']) {
    try { await stat(candidate); license = candidate; break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
if (!license) throw new Error('Set KOM_EXPORT_NODE_LICENSE to the bundled Node distribution license');
const platform = process.env.KOM_EXPORT_PLATFORM ?? process.platform;
const arch = process.env.KOM_EXPORT_ARCH ?? process.arch;
if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported target');
if (platform === process.platform && arch === process.arch && execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() !== 'v26.13.0') throw new Error('Node 26.13.0 required');
if (out === root || out.startsWith(root + '/packages/') || out.startsWith(root + '/plugins/')) throw new Error('Output must be outside source packages');
try { await stat(out); throw new Error('Output already exists; choose a fresh directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(out, { recursive: true });
const payload = join(out, '.payload');
await mkdir(join(payload, 'app/dist'), { recursive: true });
// Bundle runtime dependencies; a dereferenced pnpm graph does not preserve dependency ancestry.
const { createRequire } = await import('node:module');
const require = createRequire(await realpath(join(root, 'node_modules/tsup/package.json')));
const { build } = require('esbuild');
await build({ entryPoints: [join(root, 'packages/cli/src/index.ts')], outdir: join(payload, 'app/dist'),
  bundle: true, splitting: true, format: 'esm', platform: 'node', target: 'node26',
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
await writeFile(join(payload, 'app/package.json'), JSON.stringify({ type: 'module' }));
await cp(join(root, 'packages/hub/schema.sql'), join(payload, 'app/schema.sql'));
await cp(join(root, 'packages/hub/public'), join(payload, 'app/public'), { recursive: true });
const licenses = join(payload, 'THIRD-PARTY-LICENSES');
await mkdir(licenses);
for (const dependency of await readdir(join(root, 'node_modules/.pnpm'))) {
  const directory = join(root, 'node_modules/.pnpm', dependency, 'node_modules');
  async function collect(path, prefix) {
    let entries; try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isFile() && /^(licen[sc]e|copying|notice)([.-]|$)/i.test(entry.name)) await cp(join(path, entry.name), join(licenses, prefix + '-' + entry.name));
      else if (entry.isDirectory() && entry.name !== 'node_modules') await collect(join(path, entry.name), prefix + '-' + entry.name);
    }
  }
  await collect(directory, dependency);
}
await cp(join(root, 'LICENSE'), join(payload, 'LICENSE'));
await cp(node, join(payload, 'node')); await chmod(join(payload, 'node'), 0o755);
await cp(license, join(payload, 'NODE-LICENSE'));
await writeFile(join(payload, 'ready'), 'kommutator plugin runtime 2\n');
async function hashes(directory, prefix = '') {
  const files = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await hashes(join(directory, entry.name), name + '/'));
    else if (entry.isFile()) files[name] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
    else throw new Error('Export cannot contain symlinks');
  }
  return files;
}
const files = await hashes(payload);
const id = createHash('sha256').update(JSON.stringify(files)).digest('hex');
const release = { version, platform, arch, nodeVersion: '26.13.0', format: 2, id, files };
const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];
for (const vendor of ['claude-code', 'codex']) {
  const dest = join(out, 'plugins', vendor);
  await mkdir(dest, { recursive: true });
  await cp(join(root, 'LICENSE'), join(dest, 'LICENSE'));
  await mkdir(join(dest, 'runtime'), { recursive: true });
  await cp(payload, join(dest, 'runtime/payload'), { recursive: true });
  await cp(join(root, 'plugins/runtime/bootstrap.mjs'), join(dest, 'runtime/bootstrap.mjs'));
  await writeFile(join(dest, 'runtime/release.json'), JSON.stringify(release));
  await mkdir(join(dest, 'bin'));
  await writeFile(join(dest, 'bin/mcp'), `#!/bin/sh\nROOT=$(CDPATH= cd -- "\${0%/*}/.." && pwd) || exit 1\nexec "$ROOT/runtime/payload/node" "$ROOT/runtime/bootstrap.mjs" ${vendor}\n`);
  // Hook exec preserves the vendor parent; no copying, downloading or setup on the bounded hook path.
  await writeFile(join(dest, 'bin/hook'), `#!/bin/sh\nROOT=$(CDPATH= cd -- "\${0%/*}/.." && pwd) || exit 0\nNODE="$ROOT/runtime/payload/node"\n[ -x "$NODE" ] || exit 0\nexport KOM_PLUGIN_PROFILE=${vendor}\nexec "$NODE" "$ROOT/runtime/payload/app/dist/index.js" hook "$@"${vendor === 'codex' ? ' --vendor codex' : ''} 2>/dev/null\nexit 0\n`);
  await writeFile(join(dest, 'bin/manage'), `#!/bin/sh\nROOT=$(CDPATH= cd -- \"\${0%/*}/..\" && pwd) || exit 1\nexec \"$ROOT/runtime/payload/node\" \"$ROOT/runtime/bootstrap.mjs\" ${vendor} \"$@\"\n`);
  for (const name of ['mcp','hook','manage']) await chmod(join(dest, 'bin', name), 0o755);
  const variable = vendor === 'claude-code' ? '${CLAUDE_PLUGIN_ROOT}' : '${PLUGIN_ROOT}';
  await writeFile(join(dest, '.mcp.json'), JSON.stringify({ mcpServers: { kommutator: vendor === 'codex' ? { command: './bin/mcp', args: [], cwd: './' } : { command: variable + '/bin/mcp', args: [] } } }, null, 2));
  await mkdir(join(dest, 'hooks'));
  const hooks = Object.fromEntries(events.map(event => [event, [{ hooks: [{ type: 'command', ...(vendor === 'claude-code' ? { command: variable + '/bin/hook', args: [event] } : { command: `exec "${variable}/bin/hook" ${event}` }), timeout: 1 }] }]]));
  await writeFile(join(dest, 'hooks/hooks.json'), JSON.stringify({ hooks }, null, 2));
  const manifest = { name: 'kommutator', version, description: 'Private local agent messaging; bundled Node 26.13.0. Setup with setup_start.', mcpServers: './.mcp.json', ...(vendor === 'codex' ? { hooks: './hooks/hooks.json' } : {}) };
  await mkdir(join(dest, vendor === 'claude-code' ? '.claude-plugin' : '.codex-plugin'));
  await writeFile(join(dest, vendor === 'claude-code' ? '.claude-plugin/plugin.json' : '.codex-plugin/plugin.json'), JSON.stringify(manifest, null, 2));
  await cp(join(root, 'plugins/claude-code/skills'), join(dest, 'skills'), { recursive: true });
  await writeFile(join(dest, 'README.md'), 'Install through this artifact’s local marketplace. Call setup_status; if needed call setup_start and enter credentials only in the local browser form. Trust hooks normally and start a fresh session. Shared private configuration and immutable runtime survive plugin cache removal. Native Windows/cloud clients are unsupported. MIT licensed; see LICENSE. Bundled Node and dependencies retain their separate notices in runtime/payload.\n');
}
await rm(payload, { recursive: true });
await mkdir(join(out, '.claude-plugin'));
await writeFile(join(out, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'kommutator-local', owner: { name: 'alex-voloshin-dev' }, plugins: [{ name: 'kommutator', source: './plugins/claude-code' }] }, null, 2));
await mkdir(join(out, '.agents/plugins'), { recursive: true });
await writeFile(join(out, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'kommutator-local', plugins: [{ name: 'kommutator', source: { source: 'local', path: './plugins/codex' } }] }, null, 2));
const exported = await hashes(out);
await writeFile(join(out, 'SHA256SUMS'), Object.entries(exported).map(([path, hash]) => `${hash}  ${path}\n`).join(''));
console.log(`Exported ${platform}-${arch} marketplace: ${out}`);
