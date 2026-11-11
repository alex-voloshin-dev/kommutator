import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, symlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compareVersions, chooseRelease, assetsReady, checksReady, updateOnce, saveCheckpoint, readCheckpoint, loadDeployPolicy, run, validateCompose, validateContainer, deployRelease, normalizeTrackedSource, REPOSITORY, cutoverConstraints } from './lib/local-release-deploy.mjs';
const sha = 'a'.repeat(40);
test('actual cutover CLI rejects malformed constraints before creating state or invoking tools', async t => {
  const home = await temp(t);
  const entry = fileURLToPath(new URL('./local-release-deploy.mjs', import.meta.url));
  for (const args of [
    ['cutover'],
    ['cutover', '--expected-version', '0.4.0'],
    ['_cutover', '--expected-commit', sha],
    ['cutover', '--expected-version', '0.4.0', '--expected-version', '0.4.0'],
    ['cutover', '--expected-version', '0.4.0', '--commit', sha],
    ['cutover', '--expected-version', '0.4.0', '--expected-commit', sha, 'extra'],
    ['run', '--expected-version', '0.4.0', '--expected-commit', sha],
  ]) {
    const result = spawnSync(process.execPath, [entry, ...args], { env: { ...process.env, HOME: home, PATH: '/nonexistent' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.equal(result.stdout, ''); assert.match(result.stderr, /local release update unavailable/);
    await assert.rejects(stat(join(home, '.local')), { code: 'ENOENT' });
  }
});
test('actual cutover wrapper forwards reversed constraint order through flock to exact release lookup', async t => {
  const home = await temp(t), bin = join(home, 'bin'), policyDir = join(home, '.config/kommutator-release-deploy');
  await mkdir(bin); await mkdir(policyDir, { recursive: true, mode: 0o700 });
  await writeFile(join(policyDir, 'policy.json'), JSON.stringify({ enabled: true, repository: REPOSITORY, authorization: 'deploy-released-hub-and-agentd', baselineVersion: '0.0.0' }), { mode: 0o600 });
  const marker = join(home, 'lookup.json');
  await writeFile(join(bin, 'gh'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));process.stdout.write('{}');\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./local-release-deploy.mjs', import.meta.url)), 'cutover', '--expected-commit', sha, '--expected-version', '0.4.0'], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(await readFile(marker, 'utf8')), ['api', `repos/${REPOSITORY}/releases/tags/v0.4.0`]);
  await assert.rejects(stat(join(home, '.local/state/kommutator-release-deploy/checkpoint.json')), { code: 'ENOENT' });
});
const release = { tag_name: 'v0.4.0', draft: false, published_at: '2026-11-01', prerelease: true, assets: ['linux-x64.tar.gz', 'linux-x64.tar.gz.sha256', 'claude-linux-x64.zip', 'claude-linux-x64.zip.sha256'].map(suffix => ({ name: `kommutator-v0.4.0-${suffix}`, size: 1, state: 'uploaded' })) };
const checks = ['Release checks', 'Secret scan'].map(workflowName => ({ workflowName, databaseId: 1, headSha: sha, status: 'completed', conclusion: 'success' }));
async function temp(t) { const p = await mkdtemp(join(tmpdir(), 'kom-deploy-test-')); t.after(() => rm(p, { recursive: true, force: true })); return p; }
const discover = async (cmd, args) => cmd === 'git' ? `${sha}\trefs/tags/v0.4.0\n` : args[0] === 'api' ? JSON.stringify([release]) : JSON.stringify(checks);
function fixtures(paths) {
  return {
    compose: { name: 'kommutator', services: { hub: { user: `${process.getuid()}:${process.getgid()}`, read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], ports: [{ host_ip: '127.0.0.1', target: 8787, published: '8787', protocol: 'tcp' }], volumes: [{ type: 'bind', source: paths.data, target: '/data' }], secrets: [{ source: 'hub_key' }], environment: { KOM_HUB_PORT: '8787', KOM_KEY_FILE: '/run/secrets/hub_key', KOM_HUB_DB: '/data/kommutator.db' } } }, secrets: { hub_key: { file: paths.key } } },
    container: { Config: { User: `${process.getuid()}:${process.getgid()}`, Image: 'kommutator-hub:release-0.4.0' }, HostConfig: { ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PortBindings: { '8787/tcp': [{ HostIp: '127.0.0.1', HostPort: '8787' }] } }, Mounts: [{ Type: 'bind', Source: paths.data, Destination: '/data' }, { Type: 'bind', Source: paths.key, Destination: '/run/secrets/hub_key', RW: false }], State: { Health: { Status: 'healthy' } } },
  };
}
test('numeric versions compare numerically; published previews included, drafts/older versions excluded', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.throws(() => compareVersions('0.4.0-rc1', '0.3.0'));
  assert.equal(chooseRelease([release, { ...release, tag_name: 'v9.0.0', draft: true }], '0.3.0'), release);
  assert.equal(chooseRelease([release], '0.4.0'), undefined);
  assert.ok(assetsReady(release)); assert.equal(assetsReady({ ...release, assets: release.assets.slice(1) }), false);
  assert.ok(checksReady(checks, sha)); assert.equal(checksReady(checks, 'b'.repeat(40)), false);
  assert.equal(checksReady([...checks, { ...checks[0], databaseId: 2, conclusion: 'failure' }], sha), false);
});
test('private opt-in policy rejects missing consent and writable-state policy', async t => {
  const p = await temp(t), state = join(p, 'state'); await mkdir(state, { mode: 0o700 });
  const policy = { enabled: true, repository: REPOSITORY, authorization: 'deploy-released-hub-and-agentd', baselineVersion: '0.0.0' };
  await writeFile(join(p, 'policy'), JSON.stringify(policy), { mode: 0o600 }); assert.deepEqual(await loadDeployPolicy(join(p, 'policy'), state), policy);
  await writeFile(join(state, 'policy'), JSON.stringify(policy), { mode: 0o600 }); await assert.rejects(loadDeployPolicy(join(state, 'policy'), state));
  await writeFile(join(p, 'policy'), JSON.stringify({ ...policy, enabled: false })); await assert.rejects(loadDeployPolicy(join(p, 'policy'), state));
});
test('successful deployment checkpoints once; no repeat deployment of same version', async t => {
  const state = await temp(t), policy = { baselineVersion: '0.3.0' }; let calls = 0;
  const deploy = async () => { calls++; return { version: '0.4.0' }; };
  assert.equal((await updateOnce({ policy, state, execute: discover, deploy })).appliedVersion, '0.4.0');
  await updateOnce({ policy, state, execute: discover, deploy }); assert.equal(calls, 1);
});
test('failure and crash block subsequent mutation until explicit reconciliation', async t => {
  const state = await temp(t), policy = { baselineVersion: '0.3.0' }; let calls = 0;
  const deploy = async () => { calls++; throw new Error('uncertain activation'); };
  assert.equal((await updateOnce({ policy, state, execute: discover, deploy })).status, 'blocked');
  await updateOnce({ policy, state, execute: discover, deploy }); assert.equal(calls, 1);
  await saveCheckpoint(state, { schema: 1, appliedVersion: '0.3.0', status: 'working', targetVersion: '0.4.0' });
  assert.equal((await updateOnce({ policy, state, execute: discover, deploy })).status, 'blocked'); assert.equal(calls, 1);
});
test('missing assets or unqualified CI cannot start staging/deployment', async t => {
  const state = await temp(t); let calls = 0;
  await updateOnce({ policy: { baselineVersion: '0.3.0' }, state, execute: async () => JSON.stringify([{ ...release, assets: [] }]), deploy: async () => { calls++; } });
  const execute = async (c, a) => c === 'gh' && a[0] === 'run' ? JSON.stringify([]) : discover(c, a);
  await updateOnce({ policy: { baselineVersion: '0.3.0' }, state, execute, deploy: async () => { calls++; } }); assert.equal(calls, 0);
});
test('both deployment boundaries reject expanded port, mount or privilege access', () => {
  const paths = { data: '/private/data', key: '/private/key' }, { compose, container } = fixtures(paths);
  validateCompose(compose, paths); validateContainer(container, paths);
  for (const mutate of [x => { x.services.hub.ports[0].host_ip = '0.0.0.0'; }, x => { x.services.hub.cap_add = ['SYS_ADMIN']; }, x => { x.services.hub.volumes.push({ source: '/', target: '/host' }); }]) { const copy = structuredClone(compose); mutate(copy); assert.throws(() => validateCompose(copy, paths)); }
  for (const mutate of [x => { x.HostConfig.Privileged = true; }, x => { x.HostConfig.PortBindings['8787/tcp'].push({ HostIp: '::', HostPort: '8787' }); }, x => { x.Mounts.push({ Type: 'bind', Source: '/', Destination: '/host' }); }]) { const copy = structuredClone(container); mutate(copy); assert.throws(() => validateContainer(copy, paths)); }
});
test('staged deployment builds before backups/activation, verifies exact versions and preserves daemon backup', async t => {
  const directory = await temp(t), paths = { data: join(directory, 'hub'), key: join(directory, 'key'), daemon: join(directory, 'daemon') };
  await mkdir(paths.daemon); const db = new DatabaseSync(join(paths.daemon, 'state.db')); db.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES (\'preserved\')'); db.close();
  const { compose, container } = fixtures(paths), order = [];
  const execute = async (cmd, args, opts) => {
    const step = opts.log.split('/').pop().replace('.log', ''); order.push(step);
    if (step === 'clone') { const clone = args.at(-1); await mkdir(clone); await writeFile(join(clone, 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@12.18.0' })); }
    if (step === 'runtime-node') return JSON.stringify({ version: '26.13.0', path: process.execPath });
    if (step === 'runtime-pnpm') return '12.18.0';
    if (step === 'verify-daemon-node') return process.execPath;
    if (step === 'verify-hub-node') return '26.13.0';
    if (step === 'commit') return sha;
    if (step === 'source-modes') return `100644 ${sha} 0\tpackage.json\0`;
    if (step === 'protocol') return JSON.stringify({ version: '0.4.0' });
    if (step === 'compose') return JSON.stringify(compose);
    if (step === 'existing' || step === 'current') return 'a'.repeat(64);
    if (step === 'inspect' || step === 'verify-hub') return JSON.stringify([container]);
    if (step === 'preflight-agentd') return JSON.stringify({ daemon: { version: '0.3.0' } });
    if (step === 'preflight-hub') return JSON.stringify({ version: '0.3.0' });
    if (step === 'verify-agentd') return JSON.stringify({ daemon: { running: true, version: '0.4.0', pid: 123 }, runtime_contract: 3, hub: { connected: true }, health: { state: 'healthy' } });
    return '';
  };
  const result = await deployRelease(release, sha, directory, execute, paths); assert.equal(result.runtimeContract, 3);
  assert.ok(order.indexOf('image') < order.indexOf('smoke-image')); assert.ok(order.indexOf('smoke-image') < order.indexOf('backup-hub'));
  assert.ok(order.indexOf('image') < order.indexOf('backup-hub')); assert.ok(order.indexOf('backup-hub') < order.indexOf('activate-hub')); assert.ok(order.indexOf('activate-hub') < order.indexOf('restart-agentd'));
  const backup = new DatabaseSync(join(directory, 'agentd-before.db'), { readOnly: true }); assert.equal(backup.prepare('SELECT value FROM proof').get().value, 'preserved'); backup.close();
});
test('runner abort kills active child; already aborted command never starts', async t => {
  const state = await temp(t), marker = join(state, 'started'), controller = new AbortController();
  const promise = run(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`], { signal: controller.signal });
  let pid; for (let i = 0; i < 100; i++) { try { pid = Number(await readFile(marker, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(pid); controller.abort(); await assert.rejects(promise); assert.throws(() => process.kill(pid, 0));
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }));
});
test('successful command does not kill a detached persistent daemon', async t => {
  const state = await temp(t), marker = join(state, 'child');
  await run(process.execPath, ['-e', `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));c.unref()`]);
  const pid = Number(await readFile(marker, 'utf8')); t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch {} }); assert.doesNotThrow(() => process.kill(pid, 0));
});

test('actual built protocol exposes the release identity used by deployment preflight', async () => {
  const actual = await import('../packages/protocol/dist/index.js');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(actual.RELEASE_VERSION, pkg.version);
});

test('latest incomplete CI blocks deployment despite an older successful run', async t => {
  const state = await temp(t); let mutations = 0;
  const execute = async (cmd, args) => cmd === 'gh' && args[0] === 'run'
    ? JSON.stringify([...checks, { ...checks[0], databaseId: 2, status: 'in_progress', conclusion: '' }])
    : discover(cmd, args);
  const result = await updateOnce({ policy: { baselineVersion: '0.3.0' }, state, execute, deploy: async () => { mutations++; } });
  assert.equal(mutations, 0); assert.equal(result.status, 'idle'); assert.equal(result.appliedVersion, '0.3.0');
});

test('wrapper SIGTERM reaches the active command and its same-group descendants', async t => {
  const home = await temp(t), bin = join(home, 'bin'), policyDir = join(home, '.config/kommutator-release-deploy');
  await mkdir(bin); await mkdir(policyDir, { recursive: true, mode: 0o700 });
  await writeFile(join(policyDir, 'policy.json'), JSON.stringify({ enabled: true, repository: REPOSITORY, authorization: 'deploy-released-hub-and-agentd', baselineVersion: '0.0.0' }), { mode: 0o600 });
  const marker = join(home, 'commands.json');
  const fakeGh = `#!/usr/bin/env node
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));
setInterval(()=>{},1000);
`;
  await writeFile(join(bin, 'gh'), fakeGh); await chmod(join(bin, 'gh'), 0o700);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./local-release-deploy.mjs', import.meta.url)), 'run'], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
  const completion = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  let pids;
  t.after(() => { try { child.kill('SIGKILL'); } catch {} for (const pid of pids ?? []) { try { process.kill(pid, 'SIGKILL'); } catch {} } });
  for (let i = 0; i < 200; i++) { try { pids = JSON.parse(await readFile(marker, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.equal(pids?.length, 2, output);
  child.kill('SIGTERM');
  let timer;
  try {
    const result = await Promise.race([completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('updater wrapper did not stop')), 4000); })]);
    assert.notEqual(result.code, 0);
  } finally { clearTimeout(timer); }
  for (const pid of pids) {
    for (let i = 0; i < 100; i++) {
      let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
      if (!alive) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.throws(() => process.kill(pid, 0), `command ${pid} survived wrapper termination`);
  }
});

test('a newer actual service blocks downgrade before image creation or downtime', async t => {
  const parent = await temp(t);
  for (const newer of ['agentd', 'hub']) {
    const directory = join(parent, newer); await mkdir(directory);
    const paths = { data: join(directory, 'hub'), key: join(directory, 'key'), daemon: join(directory, 'daemon') };
    const { compose, container } = fixtures(paths), order = [];
    const execute = async (cmd, args, opts) => {
      const step = opts.log.split('/').pop().replace('.log', ''); order.push(step);
      if (step === 'clone') { const clone = args.at(-1); await mkdir(clone); await writeFile(join(clone, 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@12.18.0' })); }
      if (step === 'runtime-node') return JSON.stringify({ version: '26.13.0', path: process.execPath });
    if (step === 'runtime-pnpm') return '12.18.0';
    if (step === 'verify-daemon-node') return process.execPath;
    if (step === 'verify-hub-node') return '26.13.0';
    if (step === 'commit') return sha;
    if (step === 'source-modes') return `100644 ${sha} 0\tpackage.json\0`;
      if (step === 'protocol') return JSON.stringify({ version: '0.4.0' });
      if (step === 'compose') return JSON.stringify(compose);
      if (step === 'existing') return 'a'.repeat(64);
      if (step === 'inspect') return JSON.stringify([container]);
      if (step === 'preflight-agentd') return JSON.stringify({ daemon: { version: newer === 'agentd' ? '0.5.0' : '0.4.0' } });
      if (step === 'preflight-hub') return JSON.stringify({ version: newer === 'hub' ? '0.5.0' : '0.4.0' });
      return '';
    };
    await assert.rejects(deployRelease(release, sha, directory, execute, paths), /downgrade/);
    for (const forbidden of ['image', 'backup-hub', 'activate-hub', 'restart-agentd']) assert.ok(!order.includes(forbidden));
  }
});

test('structured command output excludes stderr warnings while private logs retain both streams', async t => {
  const directory = await temp(t), log = join(directory, 'command.log');
  const output = await run(process.execPath, ['-e', 'process.stderr.write("harmless diagnostic warning\\n");process.stdout.write(JSON.stringify({version:"0.4.0"}))'], { log });
  assert.deepEqual(JSON.parse(output), { version: '0.4.0' });
  const captured = await readFile(log, 'utf8');
  assert.match(captured, /harmless diagnostic warning/); assert.match(captured, /0\.4\.0/);
});

test('private-umask clone source modes become image-readable without exposing parent or git metadata', async t => {
  const directory = await temp(t), source = join(directory, 'source'), attempt = join(directory, 'attempt'), clone = join(attempt, 'repo');
  await mkdir(source, { mode: 0o700 }); await mkdir(attempt, { mode: 0o700 });
  await mkdir(join(source, 'docker'), { mode: 0o700 });
  await writeFile(join(source, 'docker/start.mjs'), 'export const fixture = true;\n', { mode: 0o600 });
  await writeFile(join(source, 'run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await run('git', ['init', source]); await run('git', ['add', '.'], { cwd: source });
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: source });
  await run(process.execPath, ['-e', `process.umask(0o077);const r=require('node:child_process').spawnSync('git',['clone','--no-local',${JSON.stringify(source)},${JSON.stringify(clone)}],{stdio:'inherit'});process.exit(r.status??1)`]);
  const mode = async path => (await stat(path)).mode & 0o777;
  assert.equal(await mode(join(clone, 'docker/start.mjs')), 0o600);
  assert.equal(await mode(join(clone, 'run.sh')), 0o700);
  const gitMode = await mode(join(clone, '.git'));
  await mkdir(join(clone, 'node_modules'), { mode: 0o700 });
  await writeFile(join(clone, 'node_modules/private'), 'not source', { mode: 0o600 });
  const records = await run('git', ['ls-files', '--stage', '-z'], { cwd: clone });
  await normalizeTrackedSource(clone, records);
  assert.equal(await mode(clone), 0o755);
  assert.equal(await mode(join(clone, 'docker')), 0o755);
  assert.equal(await mode(join(clone, 'docker/start.mjs')), 0o644);
  assert.equal(await mode(join(clone, 'run.sh')), 0o755);
  assert.equal(await mode(attempt), 0o700);
  assert.equal(await mode(join(clone, '.git')), gitMode);
  assert.equal(await mode(join(clone, 'node_modules/private')), 0o600);
  const outside = join(directory, 'outside'); await writeFile(outside, 'private', { mode: 0o600 });
  await symlink(outside, join(clone, 'linked'));
  await assert.rejects(normalizeTrackedSource(clone, `120000 ${sha} 0\tlinked\0`));
  assert.equal(await mode(outside), 0o600);
});

test('failed isolated image smoke prevents backups and any live activation', async t => {
  const directory = await temp(t), paths = { data: join(directory, 'real-data'), key: join(directory, 'real-key'), daemon: join(directory, 'daemon') };
  const { compose, container } = fixtures(paths), order = [];
  const execute = async (cmd, args, opts) => {
    const step = opts.log.split('/').pop().replace('.log', ''); order.push(step);
    if (step === 'clone') { const clone = args.at(-1); await mkdir(clone); await writeFile(join(clone, 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@12.18.0' })); }
    if (step === 'runtime-node') return JSON.stringify({ version: '26.13.0', path: process.execPath });
    if (step === 'runtime-pnpm') return '12.18.0';
    if (step === 'verify-daemon-node') return process.execPath;
    if (step === 'verify-hub-node') return '26.13.0';
    if (step === 'commit') return sha;
    if (step === 'source-modes') return `100644 ${sha} 0\tpackage.json\0`;
    if (step === 'protocol') return JSON.stringify({ version: '0.4.0' });
    if (step === 'compose') return JSON.stringify(compose);
    if (step === 'existing') return 'a'.repeat(64);
    if (step === 'inspect') return JSON.stringify([container]);
    if (step === 'preflight-agentd') return JSON.stringify({ daemon: { version: '0.3.0' } });
    if (step === 'preflight-hub') return JSON.stringify({ version: '0.3.0' });
    if (step === 'smoke-image') {
      assert.equal(cmd, 'docker'); assert.equal(args[0], 'run');
      assert.ok(args.includes('--rm')); assert.ok(args.includes('--read-only'));
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.equal(args[args.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
      assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
      assert.ok(!args.includes('-p') && !args.includes('--publish') && !args.includes('-v') && !args.includes('--mount'));
      assert.ok(!args.some(arg => arg.includes(paths.key) || arg.includes(paths.data)));
      throw new Error('non-root image startup failed');
    }
    return '';
  };
  await assert.rejects(deployRelease(release, sha, directory, execute, paths), /startup failed/);
  assert.ok(order.indexOf('image') < order.indexOf('smoke-image'));
  for (const forbidden of ['backup-hub', 'activate-hub', 'restart-agentd']) assert.ok(!order.includes(forbidden));
});


test('cutover requires both exact constraints and rejects duplicates, unknown flags and ordinary-run constraints', async t => {
  assert.deepEqual(cutoverConstraints(['--expected-version', '0.4.0', '--expected-commit', sha]), { version: '0.4.0', commit: sha });
  for (const args of [[], ['--expected-version', '0.4.0'], ['--expected-version', '0.4.0', '--expected-version', '0.4.0'], ['--expected-version', '0.4.0', '--other', sha], ['--expected-version', 'v0.4.0', '--expected-commit', sha], ['--expected-version', '0.4.0', '--expected-commit', 'main']]) assert.throws(() => cutoverConstraints(args));
  const state = await temp(t);
  for (const options of [{ mode: 'cutover' }, { mode: 'cutover', expected: { version: '0.4.0' } }, { expected: { version: '0.4.0', commit: sha } }]) {
    await assert.rejects(updateOnce({ state, policy: { baselineVersion: '0.3.0' }, execute: async () => assert.fail('must not discover'), ...options }));
  }
  await assert.rejects(readFile(join(state, 'checkpoint.json')), { code: 'ENOENT' });
});
test('cutover selects only requested published release even when a newer unrelated release exists', async t => {
  const state = await temp(t); let deployed;
  const execute = async (command, args) => {
    if (command === 'gh' && args[0] === 'api') { assert.ok(args[1].endsWith('/releases/tags/v0.4.0')); return JSON.stringify(release); }
    return discover(command, args);
  };
  const result = await updateOnce({ state, policy: { baselineVersion: '0.3.0' }, mode: 'cutover', expected: { version: '0.4.0', commit: sha }, execute,
    deploy: async (selected, commit, directory, executor, paths, expected) => { deployed = { selected, commit, expected }; return {}; } });
  assert.equal(deployed.selected.tag_name, 'v0.4.0'); assert.equal(deployed.commit, sha); assert.deepEqual(deployed.expected, { version: '0.4.0', commit: sha });
  assert.equal(result.status, 'idle'); assert.deepEqual(result.cutover, deployed.expected);
});
test('cutover refuses missing, substituted, draft, incomplete, old or wrong-commit candidates before staging', async t => {
  const parent = await temp(t);
  const cases = [undefined, { ...release, tag_name: 'v0.5.0' }, { ...release, draft: true }, { ...release, assets: [] }, release];
  for (let i = 0; i < cases.length; i++) {
    const state = join(parent, String(i)); await mkdir(state);
    const execute = async (command, args) => command === 'gh' && args[0] === 'api' ? JSON.stringify(cases[i] ?? null) : command === 'git' ? `${'b'.repeat(40)}\trefs/tags/v0.4.0\n` : JSON.stringify(checks);
    await assert.rejects(updateOnce({ state, policy: { baselineVersion: '0.3.0' }, mode: 'cutover', expected: { version: '0.4.0', commit: sha }, execute, deploy: async () => assert.fail('must not deploy') }));
    await assert.rejects(readFile(join(state, 'checkpoint.json')), { code: 'ENOENT' });
  }
  const state = join(parent, 'old'); await mkdir(state);
  await assert.rejects(updateOnce({ state, policy: { baselineVersion: '0.4.0' }, mode: 'cutover', expected: { version: '0.4.0', commit: sha }, execute: async () => JSON.stringify(release), deploy: async () => assert.fail('must not deploy') }));
});
test('cutover fails closed when latest checks are incomplete and preserves interrupted-state fencing', async t => {
  const state = await temp(t), expected = { version: '0.4.0', commit: sha };
  const execute = async (command, args) => command === 'gh' && args[0] === 'api' ? JSON.stringify(release) : command === 'git' ? `${sha}\trefs/tags/v0.4.0\n` : '[]';
  await assert.rejects(updateOnce({ state, policy: { baselineVersion: '0.3.0' }, mode: 'cutover', expected, execute, deploy: async () => assert.fail('must not deploy') }), /checks incomplete/);
  await saveCheckpoint(state, { schema: 1, appliedVersion: '0.3.0', status: 'working', targetVersion: '0.4.0' });
  assert.equal((await updateOnce({ state, policy: { baselineVersion: '0.3.0' }, mode: 'cutover', expected, execute: async () => assert.fail('must not discover') })).status, 'blocked');
});
test('clone moved tag or mismatched actual toolchain cannot reach activation', async t => {
  for (const failure of ['commit', 'runtime-node', 'runtime-pnpm']) {
    const directory = await temp(t), seen = [];
    const execute = async (command, args, options) => {
      const step = options.log.split('/').at(-1).replace('.log', ''); seen.push(step);
      if (step === 'clone') { await mkdir(args.at(-1)); await writeFile(join(args.at(-1), 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@12.18.0' })); }
      if (step === 'commit') return failure === 'commit' ? 'b'.repeat(40) : sha;
      if (step === 'source-modes') return `100644 ${sha} 0\tpackage.json\0`;
      if (step === 'runtime-node') return JSON.stringify({ version: failure === 'runtime-node' ? '24.22.1' : '26.13.0', path: process.execPath });
      if (step === 'runtime-pnpm') return '10.34.9';
      return '';
    };
    await assert.rejects(deployRelease(release, sha, directory, execute));
    for (const forbidden of ['install', 'backup-hub', 'activate-hub', 'restart-agentd']) assert.ok(!seen.includes(forbidden));
  }
});
