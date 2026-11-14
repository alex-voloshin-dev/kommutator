import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookDiagnostic, authorityDiagnostic, hookProcessDiagnostic, hookWaitCategory } from './lib/plugin-e2e-diagnostics.mjs';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'kom-e2e-diagnostic-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}
test('hook diagnostics reject raw error/output fields and bound numeric metadata', () => {
  const result = hookDiagnostic({ event: 'private-event', outcome: 'private-error', elapsed_ms: 1e20, exit_code: -1,
    signal: 'private-signal', stdout_bytes: 2e9, stderr_bytes: NaN, error_code: 'private-token',
    stdout: 'private-stdout', stderr: 'private-stderr', message: 'private-message' });
  assert.deepEqual(result, { event: 'unknown', outcome: 'unknown', elapsed_ms: 1_000_000, exit_code: null,
    signal: null, stdout_bytes: 1_000_000_000, stderr_bytes: null, error_code: null });
  assert(!JSON.stringify(result).includes('private'));
});
test('authority diagnostics distinguish absent and interrupted journals', async t => {
  const home = await fixture(t);
  assert.equal((await authorityDiagnostic(home, [], '/private')).context, 'absent');
  await mkdir(join(home, 'contexts', 'a'.repeat(64) + '.json.d'), { recursive: true });
  const result = await authorityDiagnostic(home, [], '/private');
  assert.equal(result.context, 'present');
  assert.equal(result.journals[0].generation_count, 0);
  assert.deepEqual(result.journals[0].entries, []);
});
test('authority diagnostics expose only identity comparisons, not persisted credentials or paths', async t => {
  const home = await fixture(t), cwd = '/private-workspace', secret = 'private-credential';
  const dir = join(home, 'contexts', 'a'.repeat(64) + '.json.d');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.json'), JSON.stringify({ generation: 1, birth: secret,
    token: secret, hello: { ppid: 123, owner_generation: 1, cwd, vendor_session_id: secret, token: secret } }));
  await writeFile(join(dir, '1.ended'), secret);
  const result = await authorityDiagnostic(home, [{ label: 'owner-1', pid: 123, alive: true, vendorId: secret }], cwd, async () => secret);
  assert.deepEqual(result.journals[0].entries, [{ generation: 1, owner_generation: 1, owner: 'owner-1',
    birth_matches: true, vendor_matches: true, cwd_matches: true, ended: true }]);
  assert(!JSON.stringify(result).includes('private'));
  assert(!JSON.stringify(result).includes('token'));
});
test('authority diagnostics contain malformed, oversized and linked records without echoing their contents', async t => {
  const home = await fixture(t), dir = join(home, 'contexts', 'a'.repeat(64) + '.json.d');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '1.json'), 'private-parse-error');
  await writeFile(join(dir, '2.json'), 'x'.repeat(65_537));
  await writeFile(join(home, 'secret'), 'private-credential');
  await symlink(join(home, 'secret'), join(dir, '3.json'));
  const result = await authorityDiagnostic(home, [], '/private');
  assert.equal(result.journals[0].generation_count, 3);
  assert.deepEqual(result.journals[0].entries, Array.from({ length: 3 }, () => ({ state: 'unreadable' })));
  assert(!JSON.stringify(result).includes('private'));
});
test('authority diagnostics bound journal and generation output', async t => {
  const home = await fixture(t);
  for (let i = 0; i < 9; i++) {
    const dir = join(home, 'contexts', String(i).repeat(64) + '.json.d');
    await mkdir(dir, { recursive: true });
    for (let n = 1; n <= 33; n++) await writeFile(join(dir, `${n}.json`), '{}');
  }
  const result = await authorityDiagnostic(home, [], '/private');
  assert.equal(result.journal_count, 9); assert.equal(result.journals.length, 8); assert.equal(result.truncated, true);
  for (const journal of result.journals) { assert.equal(journal.entries.length, 32); assert.equal(journal.truncated, true); }
});
test('real owner fixture reports hook success and failure metadata without raw stdout/stderr', async t => {
  const home = await fixture(t), bin = join(home, 'bin'); await mkdir(bin);
  const path = join(bin, 'hook'); await writeFile(path, '#!/bin/sh\n/bin/cat >/dev/null\nexit 0\n', { mode: 0o700 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/plugin-owner.mjs', import.meta.url)), home], {
    env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  let ownedHookPid;
  t.after(async () => {
    if (ownedHookPid) try { process.kill(ownedHookPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    child.kill('SIGTERM'); await closed;
  });
  let serial = 0;
  const hook = (payload = {}) => new Promise((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => reject(new Error('Owner response timed out')), 4000);
    child.once('error', reject);
    child.once('message', reply => { clearTimeout(timer); child.off('error', reject); resolve(reply); });
    child.send({ id, action: 'hook', event: 'SessionStart', payload });
  });
  const success = await hook(); assert.equal(success.result.outcome, 'success'); assert.equal(success.result.exit_code, 0);
  assert.equal(typeof success.result.started_at, 'string');
  assert.equal(success.result.process_sample, undefined);
  assert(success.result.phases.spawn_ms >= 0); assert(success.result.phases.close_ms >= 0);
  assert.equal(success.result.stdout_bytes, 0); assert.equal(success.result.stderr_bytes, 0);
  await writeFile(path, '#!/bin/sh\n/bin/cat >/dev/null\nprintf private-stdout\nprintf private-stderr >&2\n');
  const failure = await hook();
  assert.equal(failure.error, 'Hook fixture unexpected-stdout'); assert.equal(failure.diagnostic.outcome, 'unexpected-stdout');
  assert.equal(failure.diagnostic.stdout_bytes, 14); assert.equal(failure.diagnostic.stderr_bytes, 14);
  assert(!JSON.stringify(failure).includes('private'));
  await writeFile(path, `#!${process.execPath}
process.stdin.resume(); setInterval(() => {}, 1000);
`);
  const timeout = await hook();
  assert.equal(timeout.diagnostic.outcome, 'timeout');
  assert(timeout.diagnostic.phases.timeout_ms >= 1900);
  if (process.platform === 'linux') {
    assert.equal(timeout.diagnostic.process_sample.status, 'sampled');
    assert(['node', 'other'].includes(timeout.diagnostic.process_sample.processes[0].executable)); // Linux may retain the shebang script name.
  } else {
    assert.equal(timeout.diagnostic.process_sample.status, 'unsupported');
    assert.deepEqual(timeout.diagnostic.process_sample.processes, []);
  }
  assert(timeout.diagnostic.process_sample.elapsed_ms < timeout.diagnostic.phases.timeout_ms);
  assert.equal(typeof timeout.diagnostic.process_sample.sampled_at, 'string');
  const pidFile = join(home, 'hook-pid');
  await writeFile(path, `#!${process.execPath}
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
    process.on('SIGTERM', () => {});
    fs.closeSync(0);
    setInterval(() => {}, 1000);
  `);
  const closedInput = await hook({ ignored: 'x'.repeat(1_048_576) });
  ownedHookPid = Number(await readFile(pidFile, 'utf8'));
  assert(Number.isInteger(ownedHookPid) && ownedHookPid > 0 && ownedHookPid !== process.pid);
  assert.equal(closedInput.error, 'Hook fixture stdin-error');
  assert.equal(closedInput.diagnostic.error_code, 'EPIPE');
  const alive = () => { try { process.kill(ownedHookPid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  const deadline = performance.now() + 1000;
  while (alive() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(alive(), false, 'Closing stdin must not leave a live hook after its failure reply');
});
test('real Linux owner birth matches the canonical journal and distinguishes another live process', { skip: process.platform !== 'linux' }, async t => {
  const { processStart } = await import('../packages/agentd/dist/process.js');
  const home = await fixture(t), dir = join(home, 'contexts', 'b'.repeat(64) + '.json.d');
  await mkdir(dir, { recursive: true });
  const birth = await processStart(process.pid);
  assert.equal(typeof birth, 'string');
  const record = { generation: 1, birth, hello: { ppid: process.pid, owner_generation: 1, cwd: '/synthetic', vendor_session_id: 'synthetic' } };
  await writeFile(join(dir, '1.json'), JSON.stringify(record));
  const owner = [{ label: 'owner-1', pid: process.pid, alive: true, vendorId: 'synthetic' }];
  const positive = await authorityDiagnostic(home, owner, '/synthetic');
  assert.equal(positive.journals[0].entries[0].birth_matches, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { child.kill('SIGKILL'); await closed; });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const otherBirth = await processStart(child.pid);
  assert.equal(typeof otherBirth, 'string'); assert(birth !== otherBirth, 'fixture processes must have distinct births');
  await writeFile(join(dir, '1.json'), JSON.stringify({ ...record, birth: otherBirth }));
  const negative = await authorityDiagnostic(home, owner, '/synthetic');
  assert.equal(negative.journals[0].entries[0].birth_matches, false);
  await writeFile(join(dir, '1.json'), JSON.stringify({ ...record, birth: 'legacy-uncomparable' }));
  const unknown = await authorityDiagnostic(home, owner, '/synthetic');
  assert.equal(unknown.journals[0].entries[0].birth_matches, null);
  const output = JSON.stringify([positive, negative, unknown]);
  assert(!output.includes(birth)); assert(!output.includes(otherBirth)); assert(!output.includes('/synthetic'));
});

test('process diagnostic fields are allowlisted and invalid timestamps are omitted', () => {
  const value = hookDiagnostic({ outcome: 'timeout', started_at: '2026-02-30T00:00:00.000Z',
    phases: { spawn_ms: 4, timeout_ms: 2000, raw: 'private' },
    process_sample: { status: 'sampled', sampled_at: 'private', pid: 123, birth: 'private',
      processes: [{ label: 'private', state: 'private', wait: 'private', executable: 'private', cmd: 'private', cpu_ns: -1 }] } });
  assert.equal(value.started_at, undefined); assert.equal(value.process_sample.sampled_at, null);
  assert.equal(value.process_sample.processes[0].cpu_ns, null);
  assert(!JSON.stringify(value).includes('private')); assert(!JSON.stringify(value).includes('123'));
});
test('Linux sampling validates real process birth and contains cancelled probes', { skip: process.platform !== 'linux' }, async () => {
  const { processStart } = await import('../packages/agentd/dist/process.js');
  const birth = await processStart(process.pid);
  const result = await hookProcessDiagnostic(process.pid, birth);
  assert.equal(result.status, 'sampled'); assert.equal(result.processes[0].label, 'hook');
  const comm = (await readFile(`/proc/${process.pid}/comm`, 'utf8')).trim();
  assert(['node', 'nodejs', 'node-MainThread'].includes(comm), 'This fixture must run as a known Node process');
  assert.equal(result.processes[0].executable, 'node', 'A known Node process must be distinguishable from launcher/other');
  assert.equal(result.processes[0].birth_verified, true); assert(result.processes.length <= 5);
  assert(!JSON.stringify(result).includes(birth)); assert(result.processes.every(row => !Object.hasOwn(row, 'pid') && !Object.hasOwn(row, 'birth')));
  assert.equal((await hookProcessDiagnostic(process.pid, 'legacy')).status, 'unverified');
  assert.equal((await hookProcessDiagnostic(process.pid, birth, AbortSignal.abort())).status, 'unavailable');
});
test('Linux process sampling bounds descendants and emits only synthetic labels', { skip: process.platform !== 'linux' }, async t => {
  const { processStart } = await import('../packages/agentd/dist/process.js');
  const child = spawn(process.execPath, ['-e', `
    const {spawn} = require('node:child_process');
    const children = Array.from({length:6}, () => spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'}));
    Promise.all(children.map(child => new Promise(resolve => child.once('spawn',resolve)))).then(() => process.send(children.map(child => child.pid)));
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  let descendants = [];
  t.after(async () => {
    for (const pid of descendants) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    child.kill('SIGKILL'); await closed;
  });
  descendants = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
  const birth = await processStart(child.pid);
  const result = await hookProcessDiagnostic(child.pid, birth);
  assert.equal(result.status, 'sampled'); assert.equal(result.truncated, true); assert.equal(result.processes.length, 5);
  assert.deepEqual(result.processes.map(row => row.label), ['hook', 'child-1', 'child-2', 'child-3', 'child-4']);
  assert(result.processes.slice(1).every(row => row.parent === 'hook' && row.birth_verified));
  assert(!JSON.stringify(result).includes(birth));
  assert(!Object.hasOwn(result.processes[0], 'pid'));
});

test('wait categories recognize journal stalls without exposing arbitrary kernel strings', () => {
  assert.equal(hookWaitCategory('jbd2_log_wait_commit\n'), 'journal-wait');
  assert.equal(hookWaitCategory('private-kernel-symbol'), 'other');
  assert.equal(hookWaitCategory(null), 'unavailable');
  const value = hookDiagnostic({ outcome: 'timeout', process_sample: { status: 'sampled',
    processes: [{ wait: hookWaitCategory('jbd2_log_wait_commit') }, { wait: 'private-kernel-symbol' }] } });
  assert.equal(value.process_sample.processes[0].wait, 'journal-wait');
  assert.equal(value.process_sample.processes[1].wait, 'unavailable');
  assert(!JSON.stringify(value).includes('jbd2')); assert(!JSON.stringify(value).includes('private'));
});

test('non-Linux sampling reports unsupported before inspecting a process', async () => {
  const helper = new URL('./lib/plugin-e2e-diagnostics.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    Object.defineProperty(process, 'platform', {value: 'darwin'});
    const {hookProcessDiagnostic} = await import(${JSON.stringify(helper)});
    process.stdout.write(JSON.stringify(await hookProcessDiagnostic(-1, 'not-a-birth')));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { status: 'unsupported', processes: [] });
});

test('an unsettled or rejected process probe cannot delay the owner fixture kill deadline', async t => {
  for (const mode of ['pending', 'rejected']) await t.test(mode, async t => {
    const home = await fixture(t), bin = join(home, 'bin'); await mkdir(bin);
    const pidFile = join(home, 'hook-pid');
    await writeFile(join(bin, 'hook'), `#!${process.execPath}
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.stdin.resume(); setInterval(() => {}, 1000);
    `, { mode: 0o700 });
    const helper = new URL('./lib/plugin-e2e-diagnostics.mjs', import.meta.url).href;
    const source = `export {hookDiagnostic} from ${JSON.stringify(helper + '?real-diagnostic')};
      export function hookProcessDiagnostic() { return ${mode === 'pending' ? 'new Promise(() => {})' : "Promise.reject(new Error('private-probe-error'))"}; }`;
    const loader = join(home, 'probe-boundary.mjs');
    await writeFile(loader, `import {registerHooks} from 'node:module';
      registerHooks({load(url, context, nextLoad) {
        return url === ${JSON.stringify(helper)} ? {format:'module', shortCircuit:true, source:${JSON.stringify(source)}} : nextLoad(url, context);
      }});
    `);
    const child = spawn(process.execPath, ['--import', loader,
      fileURLToPath(new URL('./fixtures/plugin-owner.mjs', import.meta.url)), home], {
      env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise(resolve => child.once('close', resolve));
    let hookPid;
    t.after(async () => {
      if (hookPid) try { process.kill(hookPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      child.kill('SIGTERM'); await closed;
    });
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owner fixture response exceeded its existing 4s test bound')), 4000);
      child.once('message', value => { clearTimeout(timer); resolve(value); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.send({ id: 1, action: 'hook', event: 'SessionStart', payload: {} });
    });
    hookPid = Number(await readFile(pidFile, 'utf8'));
    assert.equal(reply.error, 'Hook fixture timeout');
    assert.equal(reply.diagnostic.process_sample.status, mode === 'pending' ? 'pending' : 'unavailable');
    assert(reply.diagnostic.phases.timeout_ms >= 1900);
    assert(reply.diagnostic.phases.timeout_ms < 3500, 'The probe must not extend the existing kill deadline');
    assert(reply.diagnostic.process_sample.elapsed_ms < reply.diagnostic.phases.timeout_ms);
    assert(!JSON.stringify(reply).includes('private-probe-error'));
    assert(!stderr.includes('private-probe-error'));
    const alive = () => { try { process.kill(hookPid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
    const deadline = performance.now() + 1000;
    while (alive() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(alive(), false, 'Diagnostic failure must not leave a live timed-out hook');
  });
});
