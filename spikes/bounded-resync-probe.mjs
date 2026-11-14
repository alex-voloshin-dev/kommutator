// Isolated real-socket control: never reads a configured hub or daemon database.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
const [hubRoot, daemonRoot, rawCount = '200', mode = 'paged'] = process.argv.slice(2);
const count = Number(rawCount);
if (!hubRoot || !daemonRoot || !Number.isInteger(count) || count < 1 || count > 200 || !['paged', 'legacy'].includes(mode)) {
  throw new Error('usage: node spikes/bounded-resync-probe.mjs HUB_CHECKOUT DAEMON_CHECKOUT [1..200] [paged|legacy]');
}
const load = (root, file) => import(pathToFileURL(resolve(root, file)).href);
const { createConformanceHarness } = await load(hubRoot, 'packages/hub/dist/testing.js');
const { createHubServer } = await load(hubRoot, 'packages/hub/dist/server.js');
const { HubLink, DaemonCore } = await load(daemonRoot, 'packages/agentd/dist/index.js');
const harness = createConformanceHarness();
const seed = harness.connect('isolated-probe');
const register = name => seed.request('session.upsert', { op: 'register', reg_id: 'register-' + name,
  session: { host: 'isolated-probe', name, vendor: 'other', capability: 'none' } }).session;
const sender = register('sender'), recipient = register('recipient');
for (let i = 0; i < count; i++) seed.request('message.send', { session_id: sender.id, idempotency_key: 'message-' + i,
  message: { from: '', to: [recipient.handle], body: 'x'.repeat(60_000) } });
seed.disconnect();
let serverErrors = 0, connects = 0, completed = 0, notifications = 0;
const server = createHubServer({ db: harness.db, runtime: harness.runtime, key: 'isolated-test-key-12345', onConnectionError: () => { serverErrors++; } });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const config = { host: 'isolated-probe', hub: 'http://127.0.0.1:' + server.address().port, key: 'isolated-test-key-12345' };
const errors = [];
const link = new HubLink(config, error => errors.push(error), 1000);
let core;
try {
  if (mode === 'legacy') link.start(async () => { connects++; await link.request('deliveries.resync', { acked: { [recipient.id]: 0 } }); completed++; }, () => { notifications++; });
  else {
    const start = link.start.bind(link);
    link.start = (connected, notification) => start(async () => { connects++; await connected(); completed++; }, (method, params) => { notifications++; notification(method, params); });
    core = new DaemonCore({ config, dbPath: ':memory:', transport: link, isAlive: async () => true });
    core.registry.save({ key: 'recipient', session: recipient, acked: 0, stopBlocked: false });
    await core.start();
  }
  const started = Date.now();
  const waitMs = mode === 'legacy' ? 1800 : 10000;
  while (Date.now() - started < waitMs && (mode === 'legacy' || completed === 0)) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const elapsedMs = Date.now() - started;
  console.log(JSON.stringify({ count, mode, elapsedMs, connects, completed, notifications, connected: link.connected, serverErrors,
    errors, unread: harness.db.prepare("SELECT count(*) AS n FROM deliveries WHERE state='unread'").get().n,
    ...(core ? { retained: core.registry.pending(recipient.id).length, acked: core.registry.get('recipient').acked } : {}) }));
} finally {
  if (core) await core.close(); else await link.close();
  await new Promise(resolve => server.close(resolve)); harness.close();
}
