import { timingSafeEqual } from 'node:crypto';
import { createStore } from './store.js';
import { ArborError } from './arbor.js';
import { synchronize } from './sync.js';
import { deviceSchedule, InputError, londonDate, validateSnapshot } from './schedule.js';

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError('Use application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('JSON body required');
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256 * 1024) { await reader.cancel(); throw new InputError('Payload exceeds 256 KiB'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InputError('Invalid JSON'); }
}

export function createHandlers({ env = process.env, store, clock = () => new Date(), syncClient } = {}) {
  const storage = () => store || createStore(env);
  const protectedHandler = (method, secretName, action) => async request => {
    if (request.method !== method) return json({ error: 'method_not_allowed' }, 405, { Allow: method });
    if (!env[secretName] || env[secretName].length < 32) return json({ error: 'server_not_configured' }, 503);
    if (!authorized(request, env[secretName])) return json({ error: 'unauthorized' }, 401);
    try { return await action(request); }
    catch (error) {
      if (error instanceof ArborError) return json({ error: error.code, message: error.message }, error.code === 'sync_busy' ? 409 : 502);
      if (error instanceof InputError) return json({ error: 'invalid_input', message: error.message }, 400);
      return json({ error: 'storage_unavailable' }, 503);
    }
  };
  return {
    schedule: protectedHandler('GET', 'DEVICE_TOKEN', async request => {
      const now = clock();
      const date = new URL(request.url).searchParams.get('date') ?? londonDate(now);
      const snapshot = await storage().get();
      if (!snapshot) return json({ error: 'schedule_not_available' }, 503);
      return json(deviceSchedule(snapshot, date, now));
    }),
    import: protectedHandler('POST', 'ADMIN_TOKEN', async request => {
      const input = await readJson(request);
      // Manual uploads cannot impersonate verified Arbor synchronization.
      if (!['manual', 'demo'].includes(input?.source)) throw new InputError('Import source must be manual or demo');
      const snapshot = validateSnapshot(input, clock());
      await storage().set(snapshot);
      return json({ ok: true, source: snapshot.source, receivedAt: snapshot.receivedAt, eventCount: snapshot.events.length });
    }),
    status: protectedHandler('GET', 'DEVICE_TOKEN', async () => json(await storage().get('status') || { state: 'never', error: null })),
    sync: protectedHandler('GET', 'CRON_SECRET', async () => json(await synchronize({ store: storage(), env, now: clock() }))),
    adminSync: protectedHandler('POST', 'ADMIN_TOKEN', async () => json(await synchronize({ store: storage(), env, client: syncClient?.(), now: clock() })))
  };
}
