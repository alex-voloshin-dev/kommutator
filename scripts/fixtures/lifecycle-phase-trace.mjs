// Opt-in synthetic lifecycle diagnostics; never included in a client export.
import { appendFileSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const home = process.env.KOM_HOME;
if (process.env.KOM_LIFECYCLE_TRACE === '1' && home &&
    dirname(home) === tmpdir() && basename(home).startsWith('kom-lifecycle-')) {
  let count = 0;
  const role = process.argv[2] === 'hook' ? 'hook' : process.argv[2] === 'daemon' ? 'daemon' : 'shim';
  const mark = (phase, hello) => {
    if (++count > 100) return;
    const owner = hello?.vendor_session_id === 'fixture-author' ? 'author'
      : hello?.vendor_session_id === 'fixture-reviewer' ? 'reviewer' : 'other';
    const event = { phase, role, owner, pid: process.pid, at_ns: process.hrtime.bigint().toString() };
    if (phase === 'entry' || phase === 'exit') {
      try { event.scheduler = readFileSync('/proc/self/schedstat', 'utf8').trim().split(/\s+/).map(Number); } catch { /* Non-Linux observation. */ }
    }
    try { appendFileSync(join(home, 'phase-trace.jsonl'), JSON.stringify(event) + '\n', { mode: 0o600 }); } catch { /* Diagnostics cannot change behavior. */ }
  };
  globalThis.__komLifecyclePhase = mark;
  mark('preload');
  process.once('exit', () => mark('exit'));
  const root = new URL('../../packages/cli/dist/', import.meta.url).href;
  registerHooks({ load(url, context, next) {
    const result = next(url, context);
    if (!url.startsWith(root) || result.format !== 'module') return result;
    let source = String(result.source);
    if (url.endsWith('/index.js')) {
      source = source.replace('if (process.argv[2] === "hook") {',
        'if (process.argv[2] === "hook") { globalThis.__komLifecyclePhase("entry");');
      source = source.replace('const deadline = setTimeout(() => process.exit(0), 140);',
        'const deadline = setTimeout(() => { globalThis.__komLifecyclePhase("deadline.fired"); process.exit(0); }, 140);');
    }
    if (url.endsWith('/index.js')) {
      source = source.replace(/(const \{ runHook \} = await import\([^;]+;)/,
        'globalThis.__komLifecyclePhase("delivery.import.started"); $1 globalThis.__komLifecyclePhase("delivery.import.finished");');
      source = source.replace(/(await runHook\([^;]+;)/,
        'globalThis.__komLifecyclePhase("delivery.run.started"); $1 globalThis.__komLifecyclePhase("delivery.run.finished");');
    }
    if (source.includes('async function readInput() {')) {
      source = source.replace('async function readInput() {',
        'async function readInput() { globalThis.__komLifecyclePhase("stdin.started");');
      source = source.replace('return JSON.parse(text);',
        'globalThis.__komLifecyclePhase("stdin.finished"); return JSON.parse(text);');
    }
    if (source.includes('async registerOwner(hello, human = false) {')) {
      source = source.replace('peer.hello = parsed.data;',
        'peer.hello = parsed.data; globalThis.__komLifecyclePhase("hello.accepted", parsed.data);');
      source = source.replace('const previous = this.registrationTail;',
        'globalThis.__komLifecyclePhase("registration.queued", hello); const previous = this.registrationTail;');
      source = source.replace('async registerOwner(hello, human = false) {',
        'async registerOwner(hello, human = false) { globalThis.__komLifecyclePhase("registration.started", hello);');
      const start = source.indexOf('async registerOwner(hello, human = false) {');
      const end = source.indexOf('\n  currentOwner(', start);
      if (end > start) {
        let section = source.slice(start, end);
        section = section.replace(/birth = pid \? await [^;]+;/,
          'globalThis.__komLifecyclePhase("birth.started", hello); $& globalThis.__komLifecyclePhase("birth.finished", hello);');
        section = section.replace(/return record[0-9]*;/,
          'globalThis.__komLifecyclePhase("local.saved", hello); $&');
        source = source.slice(0, start) + section + source.slice(end);
      }
      const helloStart = source.indexOf('if (method === "ipc.hello") {');
      const helloEnd = source.indexOf('if (!peer.hello)', helloStart);
      if (helloStart >= 0 && helloEnd > helloStart) {
        const section = source.slice(helloStart, helloEnd).replace('await this.flush();',
          'globalThis.__komLifecyclePhase("hello.flush.started", parsed.data); await this.flush(); globalThis.__komLifecyclePhase("hello.flush.finished", parsed.data);');
        source = source.slice(0, helloStart) + section + source.slice(helloEnd);
      }
      // Validate insertion rather than requiring every phase to execute: an actual
      // registration failure may legitimately stop before local save or hub flush.
      const phases = ['hello.accepted', 'registration.queued', 'registration.started',
        'birth.started', 'birth.finished', 'local.saved', 'hello.flush.started', 'hello.flush.finished'];
      mark(phases.every(phase => source.includes(`__komLifecyclePhase("${phase}"`))
        ? 'instrumentation.core' : 'instrumentation.incomplete');
    }
    return { ...result, source };
  } });
}
