import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node.split('.')[0] !== '24') throw new Error('Release qualification currently requires Linux x64 and Node 24');
async function run(command, args, env = process.env) {
  console.log(`\nRelease check: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
}
const scratch = await mkdtemp(join(tmpdir(), 'kom-release-check-'));
try {
  await run('pnpm', ['install', '--frozen-lockfile']);
  await run('pnpm', ['audit', '--audit-level', 'high']);
  await run(process.execPath, ['scripts/sync-version.mjs', '--check']);
  await run(process.execPath, ['scripts/verify-hosted-plugins.mjs']);
  await run('pnpm', ['-r', 'build']);
  await run('pnpm', ['-r', 'typecheck']);
  await run('pnpm', ['-r', 'test']);
  await run(process.execPath, ['--test', 'scripts/release-check.test.mjs', 'scripts/hub.test.mjs', 'scripts/hosted-plugin.test.mjs', 'scripts/feedback-observer.test.mjs', 'scripts/feedback-observer-process.test.mjs', 'scripts/feedback-maintainer.test.mjs', 'scripts/local-release-deploy.test.mjs']);
  const artifact = join(scratch, 'export');
  const env = { ...process.env };
  for (const name of ['KOM_EXPORT_NODE', 'KOM_EXPORT_PLATFORM', 'KOM_EXPORT_ARCH']) delete env[name];
  await run(process.execPath, ['scripts/export-plugins.mjs', artifact], env);
  await run(process.execPath, ['scripts/verify-plugin-export.mjs', artifact]);
  await run(process.execPath, ['scripts/smoke-plugin-export.mjs', artifact]);
  await run(process.execPath, ['scripts/test-plugin-export-e2e.mjs', artifact]);
  console.log('Release checks passed: Linux x64, synthetic clients only. No vendor or other-platform acceptance implied.');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
