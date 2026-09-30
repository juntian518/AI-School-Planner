import test from 'node:test';
import assert from 'node:assert/strict';
import { ArborClient, localTime, parseDayPage, findCalendarConfig } from '../lib/arbor.js';
import { synchronize } from '../lib/sync.js';
const day = (date, events = true) => ({ title: 'School day (Week B)', html:
  '<table class="mis-cal mis-cal-day"><tr><td data-datetime="' + date + ' 08:00:00"></td></tr>' +
  (events ? '<tr><td><div class="mis-cal-event" data-eventid="123"><div class="mis-cal-event-time">08:40 - 09:30 | Location: Room &amp; Lab</div><b class="title">Demo Science (KS3)</b></div></td></tr>' : '') + '</table>' });
function memoryStore() {
  const records = {}; let owner;
  return { get: async key => records[key || 'schedule'] ?? null, set: async (v, key) => { records[key || 'schedule'] = v; },
    acquire: async id => { if (owner) return false; owner = id; return true; },
    release: async id => { if (owner === id) owner = null; } };
}
test('day HTML preserves decoded names, classroom, and A/B week', () => {
  const [event] = parseDayPage(day('2026-09-30'), '2026-09-30');
  assert.equal(event.title, 'Demo Science (KS3)');
  assert.equal(event.location, 'Room & Lab');
  assert.equal(event.start, '2026-09-30T07:40:00.000Z');
  assert.equal(event.week, 'B');
  assert.deepEqual(parseDayPage(day('2026-10-02', false), '2026-10-02'), []);
});
test('parser rejects login, unexpected date, missing event time, and DST ambiguity', () => {
  assert.throws(() => parseDayPage({ html: '<form>Login</form>' }, '2026-09-30'));
  assert.throws(() => parseDayPage(day('2026-09-30'), '2026-10-01'));
  assert.throws(() => parseDayPage({ ...day('2026-09-30'), html: day('2026-09-30').html.replace('08:40 - 09:30', 'All day') }, '2026-09-30'));
  assert.throws(() => localTime('2026-10-25', '01:30'));
  assert.throws(() => localTime('2026-03-29', '01:30'));
  assert.equal(localTime('2026-12-01', '08:40'), '2026-12-01T08:40:00.000Z');
});
test('calendar configuration discovery handles nested component data', () => {
  const config = { xtype: 'mis-calendar-calendar', dataUrl: '/calendar-data', referenceObjectId: 55, referenceObjectTypeId: 1 };
  assert.equal(findCalendarConfig({ items: [{ component: { config } }] }), config);
});
test('HTTP login uses server cookies, discovered filters and cached adjacent day pages', async () => {
  const requests = [];
  const client = new ArborClient({ studentId: '55', fetcher: async (url, options) => {
    requests.push({ path: url.pathname, body: options.body, headers: options.headers });
    if (url.pathname === '/') return new Response('<html>Login</html>', { headers: { 'Set-Cookie': 'mis=initial; Path=/; Secure; HttpOnly' } });
    if (url.pathname === '/auth/login') { assert.match(options.headers.Cookie, /mis=initial/); return Response.json({ success: true }, { headers: { 'Set-Cookie': 'school_session=abc; Path=/; Secure; HttpOnly' } }); }
    assert.match(options.headers.Cookie, /school_session=abc/);
    if (url.pathname.includes('student-ui')) { assert.equal(url.searchParams.get('format'), 'javascript'); return Response.json({ content: [{ componentName: 'Arbor.calendar.Calendar', props: { referenceObjectId: 55, referenceObjectTypeId: 1 } }] }); }
    return Response.json({ items: [{ fields: { response: { value: { pages: [day('2026-09-30'), day('2026-10-01', false)] } } } }] });
  } });
  await client.login('user', 'password');
  const result = await client.snapshot('2026-09-30', 2, new Date('2026-09-30T10:00:00Z'));
  assert.equal(result.source, 'arbor'); assert.equal(result.events.length, 1);
  assert.equal(result.coverageEnd, '2026-10-01'); assert.equal(requests.length, 4);
  assert.equal(JSON.parse(requests[3].body).action_params.filters[0].value._objectId, 55);
});
test('cross-origin redirects cannot forward credentials or cookies', async () => {
  let calls = 0;
  const client = new ArborClient({ fetcher: async () => { calls++; return new Response(null, { status: 307, headers: { location: 'https://example.com/steal' } }); } });
  await assert.rejects(client.login('user', 'password'), /Unexpected school request destination/);
  assert.equal(calls, 1);
});
test('sync failure preserves last good data and reports the failure', async () => {
  const store = memoryStore(); const original = { source: 'arbor', events: ['kept'] };
  await store.set(original);
  await assert.rejects(synchronize({ store, env: {}, client: { snapshot: async () => { throw Error('secret upstream message'); } } }));
  assert.equal(await store.get(), original);
  assert.equal((await store.get('status')).state, 'error');
  assert.equal(JSON.stringify(await store.get('status')).includes('secret'), false);
  assert.equal(await store.acquire('next'), true);
});
test('sync lock prevents duplicate fetches and successful sync publishes coverage', async () => {
  const store = memoryStore();
  await store.acquire('other');
  await assert.rejects(synchronize({ store, env: {} }), /already running/);
  await store.release('other');
  const result = await synchronize({ store, client: { snapshot: async () => ({ events: [], coverageStart: '2026-09-30', coverageEnd: '2026-10-13' }) } });
  assert.equal(result.state, 'success'); assert.equal(result.eventCount, 0);
  assert.equal((await store.get('status')).coverageEnd, '2026-10-13');
});


test('lesson tooltip extracts decoded staff, supports absent staff and rejects login HTML', async () => {
  const { parseLessonDetail } = await import('../lib/arbor.js');
  assert.deepEqual(parseLessonDetail('<div class="mis-tooltip"><ul class="aligned-list"><li><b>Lesson</b>:<span>Demo</span></li><li><b>Staff</b>:<span>Mr A &amp; Ms B</span></li></ul></div>'), {staff:'Mr A & Ms B'});
  assert.deepEqual(parseLessonDetail('<div class="mis-tooltip"><ul class="aligned-list"><li><b>Lesson</b>:<span>Demo</span></li></ul></div>'), {staff:''});
  assert.throws(() => parseLessonDetail('<form>Sign in</form>'));
});
