import { londonDate } from './schedule.js';
const RETRY_MS = 10 * 60 * 1000;
export function dailySlot(now) {
  const date = londonDate(now);
  const noon = new Date(date + 'T12:00:00Z');
  const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',hour:'2-digit',hourCycle:'h23'}).format(noon));
  return new Date(Date.parse(date + 'T16:00:00Z') - (hour - 12) * 3600000);
}
export function syncDue(status, now) {
  const slot = dailySlot(now);
  const attempted = Date.parse(status?.attemptedAt || '');
  if (status?.state === 'error' || status?.state === 'running') {
    const retry = Date.parse(status.nextRetryAt || '') || attempted + RETRY_MS;
    return Number.isFinite(retry) && now.getTime() >= retry;
  }
  if (now < slot) return false;
  return !(status?.state === 'success' && attempted >= slot.getTime());
}
export const retryTime = date => new Date(date.getTime() + RETRY_MS).toISOString();
