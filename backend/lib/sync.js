import { randomUUID } from 'node:crypto';
import { ArborError, syncFromEnvironment } from './arbor.js';
export async function synchronize({ store, env, client, now = new Date() }) {
  const owner = randomUUID();
  if (!await store.acquire(owner)) throw new ArborError('sync_busy', 'A synchronization is already running');
  let previous;
  try {
    previous = await store.get('status');
    await store.set({ ...previous, state: 'running', attemptedAt: now.toISOString(), error: null }, 'status');
    const snapshot = client ? await client.snapshot(undefined, 14, now) : await syncFromEnvironment(env, now);
    await store.set(snapshot);
    const result = { state: 'success', attemptedAt: now.toISOString(), succeededAt: new Date().toISOString(),
      coverageStart: snapshot.coverageStart, coverageEnd: snapshot.coverageEnd, eventCount: snapshot.events.length, error: null };
    await store.set(result, 'status');
    return result;
  } catch (error) {
    const safe = error instanceof ArborError ? error : new ArborError('sync_failed', 'Sync failed; previous schedule was kept');
    await store.set({ ...previous, state: 'error', attemptedAt: now.toISOString(), error: { code: safe.code, message: safe.message } }, 'status');
    throw safe;
  } finally { await store.release(owner); }
}
