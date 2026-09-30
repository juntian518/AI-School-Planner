export class InputError extends Error {}
const zone = 'Europe/London';
export const MAX_AGE_MS = 26 * 60 * 60 * 1000;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function londonDate(value) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const part = type => p.find(x => x.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function text(value, name, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new InputError(`Invalid ${name}`);
  }
  return value.trim();
}

export function validateSnapshot(input, now = new Date()) {
  if (!input || input.schemaVersion !== 1 || input.timezone !== zone) {
    throw new InputError('Expected schemaVersion 1 and timezone Europe/London');
  }
  if (!['manual', 'demo', 'arbor'].includes(input.source)) throw new InputError('Invalid source');
  if (!validDate(input.coverageStart) || !validDate(input.coverageEnd) || input.coverageEnd < input.coverageStart) {
    throw new InputError('Invalid coverage range');
  }
  if (!Array.isArray(input.events) || input.events.length > 500) throw new InputError('Expected at most 500 events');
  const ids = new Set();
  const events = input.events.map(raw => {
    if (!raw || typeof raw !== 'object') throw new InputError('Invalid event');
    const id = text(raw.id, 'id', 120);
    if (ids.has(id)) throw new InputError('Duplicate event id');
    ids.add(id);
    for (const field of ['start', 'end']) {
      if (typeof raw[field] !== 'string' || !timestamp.test(raw[field]) || !Number.isFinite(Date.parse(raw[field]))) {
        throw new InputError(`Invalid ${field}: include seconds and UTC offset`);
      }
      if (!validDate(raw[field].slice(0, 10))) throw new InputError(`Invalid ${field} date`);
    }
    if (Date.parse(raw.end) <= Date.parse(raw.start)) throw new InputError('Event must end after it starts');
    const date = londonDate(raw.start);
    if (date < input.coverageStart || date > input.coverageEnd) throw new InputError('Event outside coverage');
    if (raw.week !== undefined && !['A', 'B', null].includes(raw.week)) throw new InputError('Invalid week');
    return {
      id, title: text(raw.title, 'title'),
      location: raw.location ? text(raw.location, 'location', 80) : '',
      staff: raw.staff ? text(raw.staff, 'staff', 300) : '',
      start: new Date(raw.start).toISOString(), end: new Date(raw.end).toISOString(),
      week: raw.week ?? null
    };
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, timezone: zone, source: input.source,
    coverageStart: input.coverageStart, coverageEnd: input.coverageEnd,
    receivedAt: now.toISOString(), events
  };
}

export function deviceSchedule(snapshot, date, now = new Date()) {
  if (!validDate(date)) throw new InputError('date must be a real YYYY-MM-DD date');
  const events = snapshot.events.filter(e => londonDate(e.start) === date);
  const today = date === londonDate(now);
  const ms = now.getTime();
  const covered = date >= snapshot.coverageStart && date <= snapshot.coverageEnd;
  return {
    schemaVersion: 1, timezone: zone, date, source: snapshot.source,
    receivedAt: snapshot.receivedAt, serverTime: now.toISOString(),
    stale: ms - Date.parse(snapshot.receivedAt) > MAX_AGE_MS,
    coverage: covered ? 'covered' : 'unknown',
    events,
    current: today ? events.filter(e => Date.parse(e.start) <= ms && ms < Date.parse(e.end)) : [],
    next: today ? events.find(e => Date.parse(e.start) > ms) ?? null : null
  };
}
