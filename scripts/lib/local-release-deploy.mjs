// Trusted, opt-in local deployment only. Feedback bodies never enter this program.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, lstat, realpath, open } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { redact } from './feedback-observer.mjs';

export const REPOSITORY = 'alex-voloshin-dev/kommutator';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('unsupported release version');
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function chooseRelease(releases, applied) {
  if (!Array.isArray(releases)) throw new Error('invalid release response');
  return releases.filter(release => release.draft === false && typeof release.published_at === 'string' &&
    /^v\d+\.\d+\.\d+$/.test(release.tag_name) && VERSION.test(release.tag_name.slice(1)) &&
    compareVersions(release.tag_name.slice(1), applied) > 0).sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
}
export function assetsReady(release) {
  const prefix = `kommutator-${release.tag_name}`;
  return [`${prefix}-linux-x64.tar.gz`, `${prefix}-linux-x64.tar.gz.sha256`, `${prefix}-claude-linux-x64.zip`, `${prefix}-claude-linux-x64.zip.sha256`]
    .every(name => release.assets?.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size > 0));
}
export function checksReady(runs, commit) {
  if (!Array.isArray(runs)) throw new Error('invalid CI response');
  return ['Release checks', 'Secret scan'].every(name => {
    const latest = runs.filter(run => run.headSha === commit && run.workflowName === name)
      .sort((a, b) => b.databaseId - a.databaseId)[0];
    return latest?.status === 'completed' && latest.conclusion === 'success';
  });
}
async function privateFile(path, directory = false) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('unsafe private path');
}
export async function loadDeployPolicy(path, state) {
  await privateFile(path); await privateFile(state, true);
  if ((await realpath(path)).startsWith((await realpath(state)) + sep)) throw new Error('policy must be outside writable state');
  const policy = JSON.parse(await readFile(path, 'utf8'));
  if (policy.enabled !== true || policy.repository !== REPOSITORY || policy.authorization !== 'deploy-released-hub-and-agentd' || !VERSION.test(policy.baselineVersion)) throw new Error('disabled or invalid deployment policy');
  return policy;
}
export async function readCheckpoint(state, baselineVersion) {
  try {
    await privateFile(join(state, 'checkpoint.json'));
    const value = JSON.parse(await readFile(join(state, 'checkpoint.json'), 'utf8'));
    if (value.schema !== 1 || !VERSION.test(value.appliedVersion) || !['idle', 'working', 'blocked'].includes(value.status)) throw new Error('invalid checkpoint');
    return value;
  } catch (error) { if (error.code !== 'ENOENT') throw error; return { schema: 1, appliedVersion: baselineVersion, status: 'idle' }; }
}
export async function saveCheckpoint(state, checkpoint) {
  const path = join(state, 'checkpoint.json'), temp = `${path}.${randomUUID()}`;
  const file = await open(temp, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const directory = await open(state, 'r'); try { await directory.sync(); } finally { await directory.close(); }
}

export function run(command, args, { cwd, env: extra = {}, log, signal, timeout = 1_800_000 } = {}) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SSH_AUTH_SOCK', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];
  const env = { ...Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), ...extra };
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('deployment stopped')); return; }
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', bytes = 0, failed = false, killer;
    const kill = () => { failed = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} killer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1000); };
    const collect = (chunk, stderr) => {
      bytes += chunk.length;
      if (bytes < 8_388_608) { if (stderr) diagnostics += chunk.toString(); else output += chunk.toString(); } else kill();
    };
    child.stdout.on('data', chunk => collect(chunk, false)); child.stderr.on('data', chunk => collect(chunk, true));
    const timer = setTimeout(kill, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    child.once('error', () => { clearTimeout(timer); clearTimeout(killer); signal?.removeEventListener('abort', kill); reject(new Error('deployment command unavailable')); });
    child.once('close', async code => {
      clearTimeout(timer); clearTimeout(killer); signal?.removeEventListener('abort', kill);
      // Successful CLI restart deliberately leaves a detached daemon alive.
      if (failed) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      try {
        if (log) await writeFile(log, redact(output + '\n[stderr]\n' + diagnostics), { mode: 0o600 });
        if (code !== 0 || failed) throw new Error('deployment command failed; inspect private attempt logs');
        resolve(output);
      } catch (error) { reject(error); }
    });
  });
}
export function defaultPaths(home = homedir()) {
  return { home, data: join(home, '.local/share/kommutator-hub'), key: join(home, '.config/kommutator-hub/hub.key'), daemon: join(home, '.kommutator') };
}
export function validateContainer(container, paths, uid = process.getuid(), gid = process.getgid()) {
  const host = container.HostConfig ?? {}, ports = host.PortBindings;
  if (host.Privileged || host.NetworkMode === 'host' || host.PidMode || host.IpcMode === 'host' || host.Devices?.length || host.DeviceRequests?.length || host.CapAdd?.length || !host.CapDrop?.includes('ALL') || !host.SecurityOpt?.includes('no-new-privileges:true') ||
      container.Mounts?.some(mount => mount.Type === 'bind' && !['/data', '/run/secrets/hub_key'].includes(mount.Destination))) throw new Error('existing hub isolation changed');
  const mount = destination => container.Mounts?.find(item => item.Destination === destination);
  if (container.Config?.User !== `${uid}:${gid}` || !container.HostConfig?.ReadonlyRootfs ||
      Object.keys(ports ?? {}).length !== 1 || ports['8787/tcp']?.length !== 1 || ports['8787/tcp'][0].HostIp !== '127.0.0.1' || ports['8787/tcp'][0].HostPort !== '8787' ||
      mount('/data')?.Source !== paths.data || mount('/data')?.Type !== 'bind' ||
      mount('/run/secrets/hub_key')?.Source !== paths.key || mount('/run/secrets/hub_key')?.RW !== false) throw new Error('existing hub differs from authorized default deployment');
}
export function validateCompose(config, paths, uid = process.getuid(), gid = process.getgid()) {
  const hub = config.services?.hub, port = hub?.ports?.[0];
  const data = hub?.volumes?.find(item => item.target === '/data');
  if (hub?.pid || hub?.ipc === 'host' || hub?.devices?.length || hub?.cap_add?.length || !hub?.cap_drop?.includes('ALL') || !hub?.security_opt?.includes('no-new-privileges:true') || port?.protocol !== 'tcp') throw new Error('release Compose changes isolation');
  if (config.name !== 'kommutator' || Object.keys(config.services ?? {}).length !== 1 || hub.user !== `${uid}:${gid}` || !hub.read_only ||
      hub.network_mode || hub.privileged || hub.ports?.length !== 1 || port.host_ip !== '127.0.0.1' || port.target !== 8787 || String(port.published) !== '8787' ||
      hub.volumes?.length !== 1 || data.type !== 'bind' || data.source !== paths.data ||
      config.secrets?.hub_key?.file !== paths.key || hub.secrets?.length !== 1 || hub.secrets[0].source !== 'hub_key' ||
      hub.environment?.KOM_HUB_PORT !== '8787' || hub.environment?.KOM_KEY_FILE !== '/run/secrets/hub_key' || hub.environment?.KOM_HUB_DB !== '/data/kommutator.db') throw new Error('release Compose changes authorized deployment');
}
export async function discover(execute = run) {
  const releases = JSON.parse(await execute('gh', ['api', `repos/${REPOSITORY}/releases?per_page=100`]));
  return releases;
}
export async function deployRelease(release, commit, directory, execute = run, paths = defaultPaths()) {
  const version = release.tag_name.slice(1), clone = join(directory, 'repo');
  const env = { KOM_UID: String(process.getuid()), KOM_GID: String(process.getgid()), KOM_KEY_FILE: paths.key, KOM_DATA_DIR: paths.data, KOM_PUBLISH_HOST: '127.0.0.1', KOM_PUBLISH_PORT: '8787', KOM_HOME: paths.daemon,
    XDG_CACHE_HOME: join(directory, 'cache'), XDG_DATA_HOME: join(directory, 'data') };
  const step = (name, command, args, options = {}) => execute(command, args, { cwd: clone, env, log: join(directory, `${name}.log`), ...options });
  await step('clone', 'git', ['clone', '--depth', '1', '--branch', release.tag_name, '--', `https://github.com/${REPOSITORY}.git`, clone], { cwd: directory });
  if ((await step('commit', 'git', ['rev-parse', 'HEAD'])).trim() !== commit) throw new Error('release tag moved during preparation');
  const pkg = JSON.parse(await readFile(join(clone, 'package.json'), 'utf8'));
  if (pkg.version !== version || pkg.packageManager !== 'pnpm@10.18.0') throw new Error('release source identity mismatch');
  await step('install', 'pnpm', ['install', '--frozen-lockfile']);
  await step('build', 'pnpm', ['-r', 'build']);
  const cli = join(clone, 'packages/cli/dist/index.js');
  const protocol = JSON.parse(await step('protocol', process.execPath, ['--input-type=module', '-e', 'const m=await import("./packages/protocol/dist/index.js");console.log(JSON.stringify({version:m.RELEASE_VERSION}));']));
  if (protocol.version !== version) throw new Error('built runtime identity mismatch');
  const override = join(directory, 'image.json'), image = `kommutator-hub:release-${version}`;
  await writeFile(override, JSON.stringify({ services: { hub: { image } } }), { mode: 0o600 });
  const compose = ['compose', '--project-name', 'kommutator', '--env-file', '/dev/null', '-f', join(clone, 'compose.yaml'), '-f', override];
  const config = JSON.parse(await step('compose', 'docker', [...compose, 'config', '--format', 'json'])); validateCompose(config, paths);
  const id = (await step('existing', 'docker', [...compose, 'ps', '--all', '--quiet', 'hub'])).trim();
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('existing hub required; bootstrap is not an upgrade');
  validateContainer(JSON.parse(await step('inspect', 'docker', ['inspect', id]))[0], paths);
  const previousDaemon = JSON.parse(await step('preflight-agentd', process.execPath, [cli, 'status']));
  const previousHub = JSON.parse(await step('preflight-hub', 'docker', [...compose, 'exec', '-T', 'hub', 'node', '-e', 'console.log(JSON.stringify({version:require("/app/package.json").version}))']));
  if (compareVersions(previousDaemon.daemon?.version, version) > 0 || compareVersions(previousHub.version, version) > 0) throw new Error('refusing to downgrade a running service');
  await step('image', 'docker', [...compose, 'build', 'hub']);
  await step('backup-hub', 'docker', [...compose, 'exec', '-T', 'hub', 'node', '/app/container/backup.mjs', `/data/pre-release-${version}-${Date.now()}.db`]);
  const daemonDb = new DatabaseSync(join(paths.daemon, 'state.db'), { readOnly: true });
  try { daemonDb.exec(`VACUUM INTO '${join(directory, 'agentd-before.db').replaceAll("'", "''")}'`); } finally { daemonDb.close(); }
  await step('activate-hub', 'docker', [...compose, 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120', 'hub']);
  await step('restart-agentd', process.execPath, [cli, 'daemon', 'restart']);
  let status;
  for (let attempt = 0; attempt < 20; attempt++) {
    status = JSON.parse(await step('verify-agentd', process.execPath, [cli, 'status']));
    if (status.daemon?.running === true && status.daemon?.version === version && Number.isSafeInteger(status.runtime_contract) && status.runtime_contract > 0 && status.hub?.connected && status.health?.state === 'healthy') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (status.daemon?.running !== true || status.daemon?.version !== version || !Number.isSafeInteger(status.runtime_contract) || status.runtime_contract <= 0 || !status.hub?.connected || status.health?.state !== 'healthy') throw new Error('new daemon did not become healthy');
  const current = (await step('current', 'docker', [...compose, 'ps', '--quiet', 'hub'])).trim();
  const actual = JSON.parse(await step('verify-hub', 'docker', ['inspect', current]))[0]; validateContainer(actual, paths);
  if (actual.State?.Health?.Status !== 'healthy' || actual.Config?.Image !== image) throw new Error('new hub did not become healthy');
  return { version, commit, image, daemonPid: status.daemon.pid, runtimeContract: status.runtime_contract, directory };
}
export async function updateOnce({ policy, state, execute = run, deploy = deployRelease }) {
  const checkpoint = await readCheckpoint(state, policy.baselineVersion);
  if (checkpoint.status !== 'idle') {
    if (checkpoint.status === 'working') { checkpoint.status = 'blocked'; checkpoint.error = 'Interrupted update: inspect services and backups before reconciliation.'; await saveCheckpoint(state, checkpoint); }
    return checkpoint;
  }
  const release = chooseRelease(await discover(execute), checkpoint.appliedVersion);
  if (!release || !assetsReady(release)) return checkpoint;
  const refs = await execute('git', ['ls-remote', `https://github.com/${REPOSITORY}.git`, `refs/tags/${release.tag_name}`, `refs/tags/${release.tag_name}^{}`]);
  const lines = refs.trim().split('\n'), commit = (lines.find(line => line.endsWith('^{}')) ?? lines[0])?.split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid release commit');
  const runs = JSON.parse(await execute('gh', ['run', 'list', '--repo', REPOSITORY, '--commit', commit, '--limit', '100', '--json', 'databaseId,workflowName,headSha,status,conclusion']));
  if (!checksReady(runs, commit)) return checkpoint;
  const directory = join(state, 'attempts', `${release.tag_name}-${randomUUID()}`); await mkdir(directory, { recursive: true, mode: 0o700 });
  Object.assign(checkpoint, { status: 'working', targetVersion: release.tag_name.slice(1), commit, directory }); await saveCheckpoint(state, checkpoint);
  try {
    checkpoint.result = await deploy(release, commit, directory, execute); checkpoint.appliedVersion = checkpoint.targetVersion; checkpoint.status = 'idle'; delete checkpoint.error;
  } catch { checkpoint.status = 'blocked'; checkpoint.error = 'Update failed; inspect private attempt logs and current services. No automatic retry or rollback.'; }
  await saveCheckpoint(state, checkpoint); return checkpoint;
}
