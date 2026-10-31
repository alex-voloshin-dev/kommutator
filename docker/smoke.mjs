#!/usr/bin/env node
// Run after docker compose build. Uses only a disposable Compose project/key/database.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = mkdtempSync(join(tmpdir(), "kom-docker-smoke-"));
const data = join(directory, "data");
const secret = join(directory, "hub.key");
const key = randomBytes(32).toString("hex");
mkdirSync(data, { mode: 0o700 });
writeFileSync(secret, key + "\n", { mode: 0o600 });
const project = `kom-smoke-${process.pid}`;
const env = { ...process.env, KOM_DATA_DIR: data, KOM_KEY_FILE: secret,
  KOM_UID: String(process.getuid()), KOM_GID: String(process.getgid()),
  KOM_PUBLISH_HOST: "127.0.0.1", KOM_PUBLISH_PORT: "0" };
const checks = [];
const docker = (args, input) => execFileSync("docker", args, {
  cwd: root, env, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 90_000,
});
const compose = (...args) => docker(["compose", "--project-name", project, ...args]);
const run = (script) => docker(["compose", "--project-name", project, "exec", "-T", "hub", "node", "--input-type=module"], script);
let result;
try {
  compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "45");
  let id = compose("ps", "-q", "hub").trim();
  let info = JSON.parse(docker(["inspect", id]))[0];
  assert.equal(info.Config.User, `${process.getuid()}:${process.getgid()}`);
  assert.notEqual(process.getuid(), 0, "Smoke must run as a non-root user");
  assert.equal(info.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(info.HostConfig.CapDrop, ["ALL"]);
  assert(info.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(info.HostConfig.RestartPolicy.Name, "unless-stopped");
  assert.equal(info.State.Health.Status, "healthy");
  assert(!info.Config.Env.some((value) => value.startsWith("KOM_KEY=")));
  assert.equal(info.Mounts.find((mount) => mount.Destination === "/run/secrets/hub_key").RW, false);
  const port = info.NetworkSettings.Ports["8787/tcp"][0];
  assert.equal(port.HostIp, "127.0.0.1");
  const base = `http://127.0.0.1:${port.HostPort}`;
  assert.equal((await fetch(base, { signal: AbortSignal.timeout(5_000) })).status, 401);
  const page = await fetch(base, { headers: { authorization: `Basic ${Buffer.from(`smoke:${key}`).toString("base64")}` }, signal: AbortSignal.timeout(5_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /kommutator/i);
  checks.push("isolation", "secret_mount", "authenticated_health", "published_http_auth", "dashboard");

  run(String.raw`
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, unlinkSync} from "node:fs";
assert.equal(process.getuid(), ${process.getuid()});
const status=readFileSync("/proc/self/status","utf8");
assert.match(status, /^CapEff:\s+0+$/m);
assert.match(status, /^NoNewPrivs:\s+1$/m);
assert.throws(()=>writeFileSync("/app/isolation-probe", "denied"), error=>["EROFS","EACCES"].includes(error.code));
assert.throws(()=>writeFileSync("/run/secrets/hub_key", "denied"), error=>["EROFS","EACCES"].includes(error.code));
writeFileSync("/data/isolation-probe", "allowed");
unlinkSync("/data/isolation-probe");
`);
  checks.push("runtime_write_isolation");

  run(String.raw`
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { readKey } from "./container/secret.mjs";
const key = readKey();
const clients = [];
async function connect(host) {
 const ws = new WebSocket("ws://127.0.0.1:8787", {headers:{authorization:"Bearer "+key}});
 clients.push(ws);
 const pending = new Map(); let next = 0;
 ws.on("message", raw => {
  const frame=JSON.parse(raw.toString());
  if (frame.id !== undefined && pending.has(frame.id)) {
   const p=pending.get(frame.id); pending.delete(frame.id);
   frame.error ? p.reject(new Error("RPC failure")) : p.resolve(frame.result);
  }
 });
 await once(ws,"open");
 const call=async(method,params)=>{
  const id=++next; let timer;
  try {return await new Promise((resolve,reject)=>{
   pending.set(id,{resolve,reject}); timer=setTimeout(()=>reject(new Error("RPC timeout")),5000);
   ws.send(JSON.stringify({jsonrpc:"2.0",id,method,params}));
  });} finally {clearTimeout(timer); pending.delete(id);}
 };
 await call("hello", {host,agentd_version:"docker-smoke",protocol_version:1});
 const {session}=await call("session.upsert",{op:"register",reg_id:randomUUID(),session:{host,name:"docker",vendor:"other",project_key:"docker-smoke",cwd:"/smoke"}});
 return {ws,call,session};
}
try {
 const a=await connect("docker-a"), b=await connect("docker-b");
 const delivery=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error("No delivery")),5000);
  b.ws.on("message",raw=>{const frame=JSON.parse(raw.toString());if(frame.method==="deliver"){clearTimeout(timer);resolve(frame.params);}});
 });
 const sent=await a.call("message.send",{session_id:a.session.id,idempotency_key:randomUUID(),message:{from:a.session.handle,to:[b.session.handle],kind:"dm",body:"Docker persistent message ✓"}});
 assert.equal((await delivery).message.id,sent.id);
 const read=await b.call("message.read",{session_id:b.session.id,id:sent.id});
 assert.equal(read.message.body,"Docker persistent message ✓");assert.equal(read.state,"read");
 writeFileSync("/data/expected.json",JSON.stringify({message:sent.id,recipient:b.session.id}),{mode:0o600});
} finally { for (const ws of clients) ws.terminate(); }
`);
  checks.push("two_host_registration", "send_deliver", "marked_read");
  compose("exec", "-T", "hub", "node", "/app/container/backup.mjs", "/data/backup.db");
  assert(statSync(join(data, "backup.db")).size > 0);
  assert.throws(() => compose("exec", "-T", "hub", "node", "/app/container/backup.mjs", "/data/backup.db"), /already exists/);
  checks.push("online_backup", "backup_refuses_overwrite");
  compose("up", "-d", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "45");
  const next = compose("ps", "-q", "hub").trim();
  assert.notEqual(next, id);
  const verify = `
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readKey} from "./container/secret.mjs";
const expected=JSON.parse(readFileSync("/data/expected.json","utf8"));
const response=await fetch("http://127.0.0.1:8787/api/snapshot",{headers:{authorization:"Bearer "+readKey()},signal:AbortSignal.timeout(3000)});
assert.equal(response.status,200);const snapshot=await response.json();
assert.equal(snapshot.hosts.length,2);assert.equal(snapshot.sessions.length,2);
const delivery=snapshot.deliveries.find(d=>d.id===expected.message && d.session_id===expected.recipient);
assert(delivery);assert.equal(delivery.state,"read");
`;
  run(verify);
  checks.push("recreate_persistence");
  compose("stop", "hub");
  info = JSON.parse(docker(["inspect", next]))[0];
  assert.equal(info.State.ExitCode, 0, "Graceful SIGTERM shutdown");
  compose("down");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(join(data, "kommutator.db" + suffix), { force: true });
  copyFileSync(join(data, "backup.db"), join(data, "kommutator.db"));
  compose("up", "-d", "--no-build", "--wait", "--wait-timeout", "45");
  run(verify);
  checks.push("graceful_stop", "backup_restore");
  const logs = compose("logs", "--no-color");
  assert(!logs.includes(key), "Secret in container logs");
  assert(!docker(["inspect", compose("ps", "-q", "hub").trim()]).includes(key), "Secret in container configuration");
  checks.push("no_secret_in_logs_or_inspect");

  // Kill the app process from inside the container (not docker stop/kill, which can
  // intentionally suppress restart policy); tini must exit and Docker must restart it.
  id = compose("ps", "-q", "hub").trim();
  const restarts = JSON.parse(docker(["inspect", id]))[0].RestartCount;
  try {
    run(String.raw`
import {readdirSync, readFileSync} from "node:fs";
const pid = readdirSync("/proc").find(name => {
 if (!/^\d+$/.test(name) || Number(name)===process.pid) return false;
 try { return readFileSync("/proc/"+name+"/cmdline", "utf8").startsWith("node\0/app/container/start.mjs\0"); }
 catch { return false; }
});
if (!pid) throw new Error("Hub process not found");
process.kill(Number(pid), "SIGKILL");
`);
  } catch (error) {
    // tini may terminate this exec process after its app child is killed.
    if (error.status !== 137) throw new Error(`Crash probe failed (status ${error.status}): ${error}`);
  }
  const deadline = Date.now() + 45_000;
  for (;;) {
    info = JSON.parse(docker(["inspect", id]))[0];
    if (info.RestartCount > restarts && info.State.Health?.Status === "healthy") break;
    assert(Date.now() < deadline, "Hub did not restart healthy after unexpected exit");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  run(verify);
  checks.push("unexpected_exit_restart");
  assert.throws(() => compose("run", "--rm", "--no-deps", "-e", "KOM_KEY_FILE=/run/secrets/missing", "hub"), /ENOENT/);
  const shortSecret = join(directory, "short.key");
  writeFileSync(shortSecret, "too-short", { mode: 0o600 });
  assert.throws(() => compose("run", "--rm", "--no-deps", "-v", `${shortSecret}:/run/secrets/short:ro`, "-e", "KOM_KEY_FILE=/run/secrets/short", "hub"), /Invalid hub key file/);
  checks.push("missing_secret_rejected", "short_secret_rejected");
  result = { ok: true, checks };
} catch (error) {
  result = { ok: false, checks, error: String(error).replaceAll(key, "[redacted]") };
} finally {
  try { compose("down", "--remove-orphans"); }
  catch (error) { result = { ...result, ok: false, cleanup_error: String(error).replaceAll(key, "[redacted]") }; }
  if (result.ok) rmSync(directory, { recursive: true, force: true });
  else result.disposable_data = directory;
}
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
