import postgres from 'postgres';
const connections = new Map();

export function createPostgresStore(env, injectedSql) {
  let sql = injectedSql;
  if (!sql) {
    let url;
    try { url = new URL(env.SUPABASE_DATABASE_URL); }
    catch { throw new Error('Supabase database configuration missing'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password) {
      throw new Error('Supabase database configuration missing');
    }
    // Enforce verified TLS independently of connection-string query parameters.
    url.search = '';
    const connection = url.toString();
    if (!connections.has(connection)) connections.set(connection, postgres(connection, {
      ssl: { rejectUnauthorized: true }, prepare: false, max: 1,
      idle_timeout: 20, connect_timeout: 10,
      connection: { statement_timeout: 10000 }
    }));
    sql = connections.get(connection);
  }
  const table = key => key === 'status' ? 'ai_school_planner.sync_state' : 'ai_school_planner.schedule_snapshots';
  return {
    async get(key) {
      const rows = await sql`select payload from ${sql(table(key))} where singleton = true`;
      return rows[0]?.payload ?? null;
    },
    async set(value, key) {
      await sql`insert into ${sql(table(key))} (singleton, payload, updated_at)
        values (true, ${sql.json(value)}, now())
        on conflict (singleton) do update set payload = excluded.payload, updated_at = excluded.updated_at`;
    },
    async acquire(owner) {
      const rows = await sql`insert into ai_school_planner.sync_locks (name, owner, expires_at)
        values ('arbor', ${owner}::uuid, clock_timestamp() + interval '330 seconds')
        on conflict (name) do update set owner = excluded.owner, expires_at = excluded.expires_at
        where ai_school_planner.sync_locks.expires_at <= clock_timestamp()
        returning owner`;
      return rows.length === 1;
    },
    async release(owner) {
      await sql`delete from ai_school_planner.sync_locks where name = 'arbor' and owner = ${owner}::uuid`;
    }
  };
}
