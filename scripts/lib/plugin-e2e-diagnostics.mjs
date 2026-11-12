// Diagnostic allowlists for disposable exported-plugin fixtures; never serialize raw state.
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const execute = promisify(execFile);
const events = new Set(['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse', 'UserPromptSubmit']);
const reasons = new Set(['success', 'timeout', 'spawn-error', 'stdin-error', 'nonzero-exit', 'unexpected-stdout']);
const codes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : null;
const generation = value => Number.isSafeInteger(value) && value > 0 ? value : null;
export function hookDiagnostic(value) {
  return {
    event: events.has(value.event) ? value.event : 'unknown',
    outcome: reasons.has(value.outcome) ? value.outcome : 'unknown',
    elapsed_ms: Number.isFinite(value.elapsed_ms) && value.elapsed_ms >= 0 ? Math.min(Math.round(value.elapsed_ms), 1_000_000) : null,
    exit_code: Number.isSafeInteger(value.exit_code) && value.exit_code >= 0 && value.exit_code <= 255 ? value.exit_code : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV'].includes(value.signal) ? value.signal : null,
    stdout_bytes: count(value.stdout_bytes), stderr_bytes: count(value.stderr_bytes),
    error_code: codes.has(value.error_code) ? value.error_code : null,
  };
}
async function birthForPid(pid) {
  try { return (await execute('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 1000, maxBuffer: 1024 })).stdout.trim() || null; }
  catch { return null; }
}
async function boundedRecord(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65_536) return null;
    const buffer = Buffer.alloc(65_537);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65_536) return null;
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } finally { await file.close(); }
}
export async function authorityDiagnostic(home, owners, cwd, probeBirth = birthForPid) {
  const known = [];
  for (const owner of owners.slice(0, 8)) {
    const label = /^owner-[1-8]$/.test(owner.label) ? owner.label : 'unknown';
    known.push({ ...owner, label, birth: await probeBirth(owner.pid) });
  }
  const context = join(home, 'contexts');
  let directories;
  try { directories = await readdir(context, { withFileTypes: true }); }
  catch (error) { return { context: error.code === 'ENOENT' ? 'absent' : 'unreadable', owners: known.map(x => ({ label: x.label, alive: Boolean(x.alive), birth_available: x.birth !== null })), journals: [] }; }
  const selected = directories.filter(x => x.isDirectory() && /^[a-f0-9]{64}\.json\.d$/.test(x.name));
  const journals = [];
  for (const directory of selected.slice(0, 8)) {
    let files;
    try { files = await readdir(join(context, directory.name)); }
    catch { journals.push({ state: 'unreadable' }); continue; }
    const generations = files.filter(x => /^[1-9][0-9]*\.json$/.test(x));
    const entries = [];
    for (const name of generations.slice(0, 32)) {
      let value;
      try { value = await boundedRecord(join(context, directory.name, name)); } catch { value = null; }
      if (!value) { entries.push({ state: 'unreadable' }); continue; }
      const owner = known.find(x => x.pid === value.hello?.ppid);
      entries.push({ generation: generation(value.generation), owner_generation: generation(value.hello?.owner_generation),
        owner: owner?.label ?? 'unknown', birth_matches: owner?.birth ? owner.birth === value.birth : null,
        vendor_matches: owner ? value.hello?.vendor_session_id === owner.vendorId : null,
        cwd_matches: value.hello?.cwd === cwd, ended: files.includes(name.replace('.json', '.ended')) });
    }
    journals.push({ generation_count: count(generations.length), temporary_count: count(files.filter(x => x.endsWith('.tmp')).length), truncated: generations.length > 32, entries });
  }
  return { context: 'present', owners: known.map(x => ({ label: x.label, alive: Boolean(x.alive), birth_available: x.birth !== null })), journal_count: count(selected.length), truncated: selected.length > 8, journals };
}
