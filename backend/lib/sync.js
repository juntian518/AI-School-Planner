import { syncDue, retryTime } from './sync-policy.js';
import { randomUUID } from 'node:crypto';
import { ArborError, syncFromEnvironment } from './arbor.js';
export async function synchronize({ store, env, client, now = new Date(), scheduled = false, finishedClock = () => new Date() }) {
  if (env?.ARBOR_SYNC_PAUSED === 'true') return { state: 'paused', reason: 'school_sync_paused', nextRetryAt: null };
  const owner = randomUUID();
  if (!await store.acquire(owner)) throw new ArborError('sync_busy', 'A synchronization is already running');
  let previous;
  try {
    previous = await store.get('status');
    if (scheduled && !syncDue(previous, now)) return { state: 'skipped', reason: 'daily_schedule_or_retry_wait', nextRetryAt: previous?.nextRetryAt ?? null };
    // Persist a conservative retry time in case the function is interrupted.

    await store.set({ ...previous, state: 'running', attemptedAt: now.toISOString(), nextRetryAt: retryTime(now), error: null }, 'status');
    const snapshot = client ? await client.snapshot(undefined, 14, now) : await syncFromEnvironment(env, now);
    await store.set(snapshot);
    const result = { state: 'success', attemptedAt: now.toISOString(), succeededAt: finishedClock().toISOString(), nextRetryAt: null,
      coverageStart: snapshot.coverageStart, coverageEnd: snapshot.coverageEnd, eventCount: snapshot.events.length, error: null };
    await store.set(result, 'status');
    return result;
  } catch (error) {
    const safe = error instanceof ArborError ? error : new ArborError('sync_failed', 'Sync failed; previous schedule was kept');
    await store.set({ ...previous, state: 'error', attemptedAt: now.toISOString(), nextRetryAt: retryTime(finishedClock()), error: { code: safe.code, message: safe.message } }, 'status');
    throw safe;
  } finally { await store.release(owner); }
}
