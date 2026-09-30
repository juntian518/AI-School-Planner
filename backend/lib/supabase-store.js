const SCHEMA = 'ai_school_planner';
export function createSupabaseStore(env, fetcher = fetch) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new Error('Supabase configuration missing'); }
  const secret = env.SUPABASE_SECRET_KEY;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !secret?.startsWith('sb_secret_')) {
    throw new Error('Supabase configuration invalid');
  }
  async function request(path, method = 'GET', body, prefer) {
    let response;
    try {
      response = await fetcher(new URL('/rest/v1/' + path, url), {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: secret, 'Content-Type': 'application/json',
          'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA, ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new Error('Supabase request failed'); }
    if (!response.ok) throw new Error(`Supabase storage unavailable (HTTP ${response.status})`);
    if (response.status === 204 || prefer?.includes('return=minimal')) return null;
    try { return await response.json(); } catch { throw new Error('Supabase response invalid'); }
  }
  const table = key => key === 'status' ? 'sync_state' : 'schedule_snapshots';
  return {
    async get(key) {
      const rows = await request(table(key) + '?singleton=eq.true&select=payload');
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('Supabase response invalid');
      return rows[0]?.payload ?? null;
    },
    async set(value, key) {
      await request(table(key) + '?on_conflict=singleton', 'POST', {
        singleton: true, payload: value, updated_at: new Date().toISOString()
      }, 'resolution=merge-duplicates,return=minimal');
    },
    async acquire(owner) {
      const acquired = await request('rpc/acquire_sync_lock', 'POST', { p_owner: owner });
      if (typeof acquired !== 'boolean') throw new Error('Supabase lock response invalid');
      return acquired;
    },
    async release(owner) { await request('rpc/release_sync_lock', 'POST', { p_owner: owner }); }
  };
}
