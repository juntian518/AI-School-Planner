import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { londonDate, validDate, validateSnapshot } from './schedule.js';

export class ArborError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ArborError(code, message); };
export const SCHOOL_ORIGIN = 'https://tiffin-school.uk.arbor.sc';

export function localTime(date, time) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('parse_failed', 'Invalid event date or time');
  const target = `${date}T${time}:00`;
  // Test both UK offsets and require a unique match (reject the DST overlap/gap).
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const matches = ['+00:00', '+01:00'].map(offset => new Date(target + offset))
    .filter(d => formatter.format(d).replace(' ', 'T') === target);
  if (matches.length !== 1) fail('parse_failed', 'Ambiguous or nonexistent UK local time');
  return matches[0].toISOString();
}

export function parseDayPage(page, expectedDate) {
  if (!page || typeof page.html !== 'string') fail('parse_failed', 'Calendar response is missing HTML');
  const $ = load(page.html);
  if ($('table.mis-cal-day').length !== 1) fail('parse_failed', 'Expected one Arbor day calendar');
  const dates = [...new Set($('table.mis-cal-day [data-datetime]').map((_, el) => $(el).attr('data-datetime').slice(0, 10)).get())];
  if (dates.length !== 1 || dates[0] !== expectedDate) fail('parse_failed', 'Returned calendar date does not match requested date');
  const week = String(page.title || '').match(/Week\s+([AB])\b/)?.[1] ?? null;
  const events = [];
  $('.mis-cal-day .mis-cal-event').each((_, element) => {
    const el = $(element);
    const id = el.attr('data-eventid');
    const title = el.find('.title').text().replace(/\s+/g, ' ').trim();
    const details = el.find('.mis-cal-event-time').text().replace(/\s+/g, ' ').trim();
    const match = details.match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\|\s*Location:\s*(.*))?$/);
    if (!id || !title || !match) fail('parse_failed', 'An event has an unsupported format; previous schedule was kept');
    events.push({ id: `${expectedDate}:${id}`, title, location: match[3] || '',
      start: localTime(expectedDate, match[1]), end: localTime(expectedDate, match[2]), week });
  });
  return events;
}

export function findCalendarConfig(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.componentName === 'Arbor.calendar.Calendar' && value.props?.referenceObjectId) {
    return { dataUrl: '/calendar-entry/list-static/format/json/', ...value.props };
  }
  if ((value.xtype === 'mis-calendar-calendar' || value.componentName === 'Calendar') && value.dataUrl) return value;
  if (value.dataUrl && value.referenceObjectId) return value;
  for (const child of Object.values(value)) {
    const match = findCalendarConfig(child);
    if (match) return match;
  }
  return null;
}

export function addDays(date, n) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export class ArborClient {
  constructor({ studentId = '8408', fetcher = fetch } = {}) {
    if (!/^\d+$/.test(studentId)) fail('not_configured', 'Invalid student ID');
    this.studentId = studentId;
    this.fetcher = fetcher;
    this.jar = new CookieJar();
    this.ready = false;
    this.stage = 'initialization';
    this.diagnostics = [];
  }
  async request(path, body, redirects = 0, html = false) {
    const url = new URL(path, SCHOOL_ORIGIN);
    if (url.origin !== SCHOOL_ORIGIN || url.username || url.password) fail('upstream_rejected', 'Unexpected school request destination');
    const cookie = await this.jar.getCookieString(url.href);
    let response;
    try {
      response = await this.fetcher(url, { method: body === undefined ? 'GET' : 'POST',
        headers: { Accept: html ? 'text/html' : 'application/json',
          ...(html ? {} : { 'X-Requested-With': 'XMLHttpRequest' }),
          Origin: SCHOOL_ORIGIN, Referer: SCHOOL_ORIGIN + '/',
          ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual', signal: AbortSignal.timeout(15000)
      });
    } catch { fail('upstream_unavailable', 'Cannot reach Arbor; previous schedule was kept'); }
    this.diagnostics.push({ stage: this.stage, path: url.pathname, status: response.status });
    for (const value of response.headers.getSetCookie()) await this.jar.setCookie(value, url.href);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= 3) fail('login_required', 'Arbor redirected repeatedly; reconnect your account');
      const destination = new URL(response.headers.get('location'), url);
      return this.request(destination.href, [307, 308].includes(response.status) ? body : undefined, redirects + 1, html);
    }
    if ([401, 403].includes(response.status)) fail('login_required', 'Arbor login expired or access was denied');
    if (!response.ok) fail('upstream_unavailable', `Arbor ${this.stage}: HTTP ${response.status}`);
    const raw = await response.text();
    if (raw.length > 8 * 1024 * 1024) fail('parse_failed', 'School response exceeds supported size');
    if (html) return raw;
    try { return JSON.parse(raw); }
    catch { fail('login_required', 'Arbor did not return calendar data; reconnect your account'); }
  }
  async login(username, password) {
    if (!username || !password) fail('not_configured', 'School username and password are required');
    this.stage = 'session initialization';
    await this.request('/', undefined, 0, true);
    this.stage = 'login';
    const result = await this.request('/auth/login', { items: [{ username, password }] });
    if (result.success === false || result.items?.some(item => item.success === false || item.error)) {
      fail('login_required', 'School login was not accepted');
    }
    this.stage = 'calendar configuration';
    const page = await this.request(`/guardians/student-ui/calendar/id/${this.studentId}?format=javascript`);
    const config = findCalendarConfig(page);
    if (!config) fail('calendar_config_missing', 'Login response received, but calendar configuration could not be found');
    // Config, including object IDs and dataUrl, comes from the authenticated school response.
    this.config = config;
    this.ready = true;
    this.stage = 'calendar sync';
  }
  async snapshot(start = londonDate(new Date()), days = 14, now = new Date()) {
    if (!this.ready) fail('login_required', 'Connect your Arbor account first');
    if (!validDate(start) || !Number.isInteger(days) || days < 1 || days > 14) fail('invalid_range', 'Sync range must be 1–14 days');
    const end = addDays(start, days - 1);
    const events = [];
    const cachedPages = new Map();
    for (let offset = 0; offset < days; offset++) {
      const date = addDays(start, offset);
      if (!cachedPages.has(date)) {
        const filters = [];
        if (this.config.referenceObjectId && this.config.referenceObjectTypeId) filters.push({ field_name: 'object', value: {
          _objectTypeId: this.config.referenceObjectTypeId, _objectId: this.config.referenceObjectId
        } });
        const response = await this.request(this.config.dataUrl, { action_params: { view: 'day', startDate: date, endDate: date, filters } });
        const value = response.items?.[0]?.fields?.response?.value;
        if (!value || !Array.isArray(value.pages)) fail('parse_failed', 'Arbor calendar response format has changed');
        for (const page of value.pages) {
          const $ = load(page.html || '');
          const pageDate = $('table.mis-cal-day [data-datetime]').first().attr('data-datetime')?.slice(0, 10);
          if (pageDate) cachedPages.set(pageDate, page);
        }
      }
      events.push(...parseDayPage(cachedPages.get(date), date));
    }
    return validateSnapshot({ schemaVersion: 1, timezone: 'Europe/London', source: 'arbor',
      coverageStart: start, coverageEnd: end, events }, now);
  }
}

export async function syncFromEnvironment(env, now = new Date()) {
  const client = new ArborClient({ studentId: env.ARBOR_STUDENT_ID || '8408' });
  await client.login(env.ARBOR_USERNAME, env.ARBOR_PASSWORD);
  return client.snapshot(londonDate(now), 14, now);
}
