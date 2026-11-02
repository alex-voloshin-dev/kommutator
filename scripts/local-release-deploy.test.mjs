import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { compareVersions, chooseRelease, assetsReady, checksReady, updateOnce, saveCheckpoint, readCheckpoint, loadDeployPolicy, run, validateCompose, validateContainer, deployRelease, REPOSITORY } from './lib/local-release-deploy.mjs';
const sha = 'a'.repeat(40);
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
    if (step === 'clone') { const clone = args.at(-1); await mkdir(clone); await writeFile(join(clone, 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@10.18.0' })); }
    if (step === 'commit') return sha;
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
      if (step === 'clone') { const clone = args.at(-1); await mkdir(clone); await writeFile(join(clone, 'package.json'), JSON.stringify({ version: '0.4.0', packageManager: 'pnpm@10.18.0' })); }
      if (step === 'commit') return sha;
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
