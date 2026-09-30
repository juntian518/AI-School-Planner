import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSnapshot, deviceSchedule, londonDate, validDate } from '../lib/schedule.js';
import { createHandlers } from '../lib/handlers.js';
import { createStore } from '../lib/store.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
const now = new Date('2030-06-03T07:50:00Z');
const env = { DEVICE_TOKEN: 'd'.repeat(32), ADMIN_TOKEN: 'a'.repeat(32), CRON_SECRET: 'c'.repeat(32) };
const request = (path, token, body, method = body ? 'POST' : 'GET') => new Request(`https://planner.test${path}`, {
  method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {})
});

test('London dates handle summer, winter, and DST transitions', () => {
  assert.equal(londonDate('2030-06-03T23:30:00Z'), '2030-06-04');
  assert.equal(londonDate('2030-01-03T23:30:00Z'), '2030-01-03');
  assert.equal(londonDate('2026-03-29T23:30:00Z'), '2026-03-30');
  assert.equal(londonDate('2026-10-25T23:30:00Z'), '2026-10-25');
  assert.equal(validDate('2030-02-30'), false);
});

test('current and next obey exact lesson boundaries', () => {
  const snapshot = validateSnapshot(fixture, now);
  const during = deviceSchedule(snapshot, '2030-06-03', now);
  assert.equal(during.current[0].id, 'demo-1');
  assert.equal(during.next.id, 'demo-2');
  const boundary = deviceSchedule(snapshot, '2030-06-03', new Date('2030-06-03T08:30:00Z'));
  assert.deepEqual(boundary.current.map(e => e.id), ['demo-2']);
  assert.equal(boundary.next, null);
});

test('unknown coverage and stale data are distinct from a covered empty day', () => {
  const snapshot = validateSnapshot({ ...fixture, events: [] }, now);
  assert.equal(deviceSchedule(snapshot, '2030-06-03', now).coverage, 'covered');
  const unknown = deviceSchedule(snapshot, '2030-06-04', new Date('2030-06-04T10:50:00Z'));
  assert.equal(unknown.coverage, 'unknown');
  assert.equal(unknown.stale, true);
  assert.deepEqual(unknown.current, []);
});

test('validation rejects ambiguous times, impossible dates, duplicates and invalid ranges', () => {
  for (const change of [
    { start: '2030-06-03T08:40:00' },
    { start: '2030-02-30T08:40:00Z' },
    { end: '2030-06-03T07:00:00Z' },
    { week: 'C' }
  ]) assert.throws(() => validateSnapshot({ ...fixture, events: [{ ...fixture.events[0], ...change }] }, now));
  assert.throws(() => validateSnapshot({ ...fixture, events: [fixture.events[0], fixture.events[0]] }, now));
  assert.throws(() => validateSnapshot({ ...fixture, coverageEnd: '2030-06-02' }, now));
});

test('overlapping activities are retained and user supplied receivedAt is ignored', () => {
  const snapshot = validateSnapshot({ ...fixture, receivedAt: '2099-01-01T00:00:00Z', events: [
    fixture.events[0], { ...fixture.events[0], id: 'overlap' }
  ] }, now);
  assert.equal(snapshot.receivedAt, now.toISOString());
  assert.equal(deviceSchedule(snapshot, '2030-06-03', now).current.length, 2);
});

test('API import/read roundtrip, auth separation, no-store, and unconfigured sync', async () => {
  let saved = null;
  let status = null;
  const store = { get: async key => key === 'status' ? status : saved, set: async (value,key) => { if (key === 'status') status = value; else saved = value; }, acquire: async () => true, release: async () => {} };
  const h = createHandlers({ env, store, clock: () => now });
  assert.equal((await h.schedule(request('/api/schedule', env.DEVICE_TOKEN))).status, 503);
  assert.equal((await h.schedule(request('/api/schedule', env.ADMIN_TOKEN))).status, 401);
  assert.equal((await h.import(request('/api/import', env.DEVICE_TOKEN, fixture))).status, 401);
  assert.equal((await h.import(request('/api/import', env.ADMIN_TOKEN, fixture))).status, 200);
  const result = await h.schedule(request('/api/schedule', env.DEVICE_TOKEN));
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).current[0].id, 'demo-1');
  assert.equal((await h.schedule(request('/api/schedule?date=2030-02-30', env.DEVICE_TOKEN))).status, 400);
  assert.equal((await h.sync(request('/api/sync', env.CRON_SECRET))).status, 200);
  const due = createHandlers({ env, store, clock: () => new Date('2030-06-03T15:00:00Z') });
  assert.equal((await due.sync(request('/api/sync', env.CRON_SECRET))).status, 502);
  assert.equal(status.error.code, 'not_configured');
  assert.equal(saved.events.length, 2);
});

test('invalid imports preserve last good snapshot; manual import cannot claim Arbor sync', async () => {
  let saved = validateSnapshot(fixture, now);
  const original = saved;
  const h = createHandlers({ env, store: { get: async () => saved, set: async v => { saved = v; } } });
  for (const body of [{ ...fixture, source: 'arbor' }, { ...fixture, events: [null] }, null]) {
    const req = new Request('https://planner.test/api/import', { method: 'POST',
      headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await h.import(req)).status, 400);
    assert.equal(saved, original);
  }
});

test('missing secrets fail closed, wrong methods rejected, storage errors sanitized', async () => {
  assert.equal((await createHandlers({ env: {} }).schedule(request('/api/schedule', ''))).status, 503);
  const h = createHandlers({ env, store: { get: async () => { throw Error('SECRET'); } } });
  const failed = await h.schedule(request('/api/schedule', env.DEVICE_TOKEN));
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('SECRET'), false);
  assert.equal((await h.schedule(request('/api/schedule', env.DEVICE_TOKEN, {}, 'POST'))).status, 405);
});

test('large and malformed payloads cannot replace cached data', async () => {
  let writes = 0;
  const h = createHandlers({ env, store: { set: async () => { writes++; } } });
  for (const body of ['{', JSON.stringify({ padding: 'x'.repeat(270000) })]) {
    const req = new Request('https://planner.test/api/import', { method: 'POST', headers: {
      authorization: `Bearer ${env.ADMIN_TOKEN}`, 'content-type': 'application/json'
    }, body });
    assert.equal((await h.import(req)).status, 400);
  }
  assert.equal(writes, 0);
});

test('local file store survives reopening and refuses production filesystem persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'school-planner-test-'));
  try {
    const config = { STORAGE_DRIVER: 'file', DATA_DIR: dir };
    const store = createStore(config);
    assert.equal(await store.get(), null);
    await store.set(validateSnapshot(fixture, now));
    assert.equal((await createStore(config).get()).events.length, 2);
    await store.set(validateSnapshot({ ...fixture, events: [] }, now));
    assert.deepEqual((await store.get()).events, []);
    assert.throws(() => createStore({ ...config, VERCEL: '1' }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Redis REST stores a complete snapshot without expiring the offline fallback', async () => {
  const calls = [];
  let value = null;
  const store = createStore({ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test' }, async (url, options) => {
    assert.equal(url.protocol, 'https:');
    const args = JSON.parse(options.body); calls.push(args);
    if (args[0] === 'SET') { value = args[2]; return Response.json({ result: 'OK' }); }
    return Response.json({ result: value });
  });
  assert.equal(await store.get(), null);
  await store.set(validateSnapshot(fixture, now));
  assert.equal((await store.get()).source, 'demo');
  assert.equal(calls[1].length, 3);
});


test('device snapshot returns full offline coverage only with device authorization', async () => {
  const saved = validateSnapshot(fixture, now);
  const h = createHandlers({ env, store: {get:async()=>saved} });
  assert.equal((await h.snapshot(request('/api/device-snapshot',env.ADMIN_TOKEN))).status,401);
  const result = await h.snapshot(request('/api/device-snapshot',env.DEVICE_TOKEN));
  assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.deepEqual(await result.json(),saved);
});
