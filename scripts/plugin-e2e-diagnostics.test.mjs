import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookDiagnostic, authorityDiagnostic } from './lib/plugin-e2e-diagnostics.mjs';
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
  assert.equal(success.result.stdout_bytes, 0); assert.equal(success.result.stderr_bytes, 0);
  await writeFile(path, '#!/bin/sh\n/bin/cat >/dev/null\nprintf private-stdout\nprintf private-stderr >&2\n');
  const failure = await hook();
  assert.equal(failure.error, 'Hook fixture unexpected-stdout'); assert.equal(failure.diagnostic.outcome, 'unexpected-stdout');
  assert.equal(failure.diagnostic.stdout_bytes, 14); assert.equal(failure.diagnostic.stderr_bytes, 14);
  assert(!JSON.stringify(failure).includes('private'));
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
