// Diagnostic allowlists for disposable exported-plugin fixtures; never serialize raw state.
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { processStart, compareProcessBirth, linuxProcessBirth } from '../../packages/agentd/dist/process.js';
import { join } from 'node:path';
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
    ...(timestamp(value.started_at) ? { started_at: value.started_at } : {}),
    ...(value.phases && typeof value.phases === 'object' ? { phases: Object.fromEntries(
      ['spawn_ms', 'stdin_finish_ms', 'close_ms', 'timeout_ms'].map(key => [key, elapsed(value.phases[key])])) } : {}),
    ...(value.outcome !== 'success' && value.process_sample ? { process_sample: processSample(value.process_sample) } : {}),
  };
}
async function birthForPid(pid) { return await processStart(pid) ?? null; }
function birthMatches(a, b) {
  const comparison = compareProcessBirth(typeof a === 'string' ? a : undefined, typeof b === 'string' ? b : undefined);
  return comparison === 'unverified' ? null : comparison === 'same';
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
    known.push({ ...owner, label, birth: await probeBirth(owner.pid) ?? null });
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
        owner: owner?.label ?? 'unknown', birth_matches: birthMatches(owner?.birth, value.birth),
        vendor_matches: owner ? value.hello?.vendor_session_id === owner.vendorId : null,
        cwd_matches: value.hello?.cwd === cwd, ended: files.includes(name.replace('.json', '.ended')) });
    }
    journals.push({ generation_count: count(generations.length), temporary_count: count(files.filter(x => x.endsWith('.tmp')).length), truncated: generations.length > 32, entries });
  }
  return { context: 'present', owners: known.map(x => ({ label: x.label, alive: Boolean(x.alive), birth_available: x.birth !== null })), journal_count: count(selected.length), truncated: selected.length > 8, journals };
}

const elapsed = value => Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1_000_000) : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const processStates = new Set(['R', 'S', 'D', 'Z', 'T', 't', 'I', 'X']);
const waits = new Map([['ep_poll', 'event-loop'], ['do_epoll_wait', 'event-loop'], ['do_wait', 'child-wait'],
  ['futex_wait_queue', 'futex-wait'], ['futex_wait_queue_me', 'futex-wait'], ['hrtimer_nanosleep', 'sleep'],
  ['folio_wait_bit_common', 'io-wait'], ['wait_on_page_bit_common', 'io-wait'], ['io_schedule', 'io-wait'], ['0', 'running-or-unavailable']]);
const labels = new Set(['hook', 'child-1', 'child-2', 'child-3', 'child-4']);
function processSample(value) {
  const states = new Set(['sampled', 'pending', 'not-started', 'unavailable', 'unsupported', 'unverified']);
  const counters = number => Number.isSafeInteger(number) && number >= 0 ? number : null;
  return {
    status: states.has(value.status) ? value.status : 'unavailable',
    sampled_at: timestamp(value.sampled_at) ? value.sampled_at : null,
    elapsed_ms: elapsed(value.elapsed_ms), truncated: value.truncated === true,
    processes: (Array.isArray(value.processes) ? value.processes : []).slice(0, 5).map(row => ({
      label: labels.has(row?.label) ? row.label : 'unknown', parent: labels.has(row?.parent) ? row.parent : null,
      state: processStates.has(row?.state) ? row.state : null,
      executable: ['node', 'python', 'shell', 'other'].includes(row?.executable) ? row.executable : 'other',
      wait: new Set([...waits.values(), 'other', 'unavailable']).has(row?.wait) ? row.wait : 'unavailable',
      birth_verified: row?.birth_verified === true,
      cpu_ns: counters(row?.cpu_ns), runqueue_ns: counters(row?.runqueue_ns), slices: counters(row?.slices),
    })),
  };
}
async function boundedText(path, limit = 4096) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) return null;
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}
/** Best-effort Linux-only sample. Caller never awaits it from its kill deadline. */
export async function hookProcessDiagnostic(pid, expectedBirth, signal) {
  if (process.platform !== 'linux') return { status: 'unsupported', processes: [] };
  if (!Number.isSafeInteger(pid) || pid <= 0 || typeof expectedBirth !== 'string') return { status: 'unverified', processes: [] };
  try {
    const boot = (await boundedText('/proc/sys/kernel/random/boot_id', 64))?.trim();
    if (!boot || signal?.aborted) return { status: 'unavailable', processes: [] };
    const queue = [{ pid, label: 'hook', parent: null, parentPid: null }];
    const processes = []; let truncated = false; let assigned = 0;
    while (queue.length && processes.length < 5) {
      if (signal?.aborted) return { status: 'unavailable', processes: [] };
      const item = queue.shift(); const base = `/proc/${item.pid}`;
      const stat = await boundedText(`${base}/stat`);
      const birth = stat && linuxProcessBirth(stat, boot);
      if (!birth || (item.label === 'hook' && compareProcessBirth(birth, expectedBirth) !== 'same')) return { status: 'unverified', processes: [] };
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      const executable = /^node(?:js)?$/.test(comm) ? 'node' : /^python[0-9.]*$/.test(comm) ? 'python' : /^(?:ba|da|z|a)?sh$/.test(comm) ? 'shell' : 'other';
      const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
      if (item.parentPid !== null && Number(fields[1]) !== item.parentPid) continue;
      const [wait, scheduling, children, after] = await Promise.all([
        boundedText(`${base}/wchan`, 128).catch(() => null), boundedText(`${base}/schedstat`, 256).catch(() => null),
        boundedText(`${base}/task/${item.pid}/children`).catch(() => null), boundedText(`${base}/stat`).catch(() => null),
      ]);
      if (signal?.aborted) return { status: 'unavailable', processes: [] };
      if (!after || compareProcessBirth(birth, linuxProcessBirth(after, boot)) !== 'same') continue;
      const counters = scheduling?.trim().split(/\s+/).map(Number) ?? [];
      processes.push({ executable, label: item.label, parent: item.parent, state: fields[0], wait: waits.get(wait?.trim()) ?? (wait === null ? 'unavailable' : 'other'),
        birth_verified: true, cpu_ns: counters[0], runqueue_ns: counters[1], slices: counters[2] });
      if (children === null) { truncated = true; continue; }
      for (const child of children.trim().split(/\s+/).filter(Boolean)) {
        if (assigned >= 4) { truncated = true; break; }
        if (!/^[1-9][0-9]*$/.test(child) || !Number.isSafeInteger(Number(child))) continue;
        queue.push({ pid: Number(child), label: `child-${++assigned}`, parent: item.label, parentPid: item.pid });
      }
    }
    const finalStat = await boundedText(`/proc/${pid}/stat`);
    if (signal?.aborted || !finalStat || compareProcessBirth(linuxProcessBirth(finalStat, boot), expectedBirth) !== 'same') return { status: 'unverified', processes: [] };
    return processSample({ status: 'sampled', truncated, processes });
  } catch { return { status: 'unavailable', processes: [] }; }
}
