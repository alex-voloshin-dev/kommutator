import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const artifact = resolve(process.argv[2]);
const home = await mkdtemp(join(tmpdir(), 'kom-export-smoke-'));
async function test(vendor) {
  const child = spawn(join(artifact, 'plugins', vendor, 'bin/mcp'), [], {
    cwd: '/', env: { HOME: home, KOM_HOME: join(home, 'kom'), CODEX_HOME: join(home, 'codex'), PATH: '/nonexistent' }, stdio: ['pipe','pipe','pipe'],
  });
  let buffer = ''; let errors = ''; let id = 0;
  const pending = new Map();
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0,end); buffer = buffer.slice(end + 1); const value = JSON.parse(line); pending.get(value.id)?.(value); } });
  async function request(method, params) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout ${method}: ${errors}`)); }, 30000);
      pending.set(requestId, value => { clearTimeout(timer); pending.delete(requestId); value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result); });
      child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id: requestId, method, params })+'\n');
    });
  }
  try {
    const initialized = await request('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{ name:vendor === 'codex' ? 'codex' : 'claude-code',version:'smoke' } });
    const release = JSON.parse(await readFile(join(artifact, 'plugins', vendor, 'runtime/release.json'), 'utf8'));
    assert.equal(initialized.serverInfo.version, release.version);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed = await request('tools/list', {});
    assert(listed.tools.some(tool => tool.name === 'setup_start'));
    assert.deepEqual(JSON.parse((await request('tools/call',{ name:'setup_status',arguments:{} })).content[0].text), {configured:false});
    const missing = await request('tools/call',{name:'whoami',arguments:{},_meta:{sessionId:'one',threadId:'one'}});
    assert.equal(missing.isError,true); assert.match(missing.content[0].text,/Setup required/);
    const setup = JSON.parse((await request('tools/call',{name:'setup_start',arguments:{}})).content[0].text);
    assert.equal(new URL(setup.url).hostname, '127.0.0.1');
    assert.equal((await fetch(setup.url)).status,200);
    assert.equal((await fetch(setup.url,{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
    const stable = await readdir(join(home,'kom/runtimes'));
    assert.equal(stable.filter(name => /^[a-f0-9]{64}$/.test(name)).length,1);
    // Ongoing MCP runs from shared storage, independent of the disposable cache payload.
    const runtime = join(artifact,'plugins',vendor,'runtime');
    await rename(runtime, runtime+'.hidden');
    try { assert.equal(JSON.parse((await request('tools/call',{name:'setup_status',arguments:{}})).content[0].text).configured,false); }
    finally { await rename(runtime+'.hidden',runtime); }
    console.log(`${vendor}: clean PATH initialize/tools/private setup/cache removal passed`);
  } finally { if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit',resolve)); } }
}
try { await test('claude-code'); await test('codex'); } finally { await rm(home,{recursive:true,force:true}); }
