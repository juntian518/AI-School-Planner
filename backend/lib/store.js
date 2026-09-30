import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
const locks = new Map();

export function createStore(env = process.env, fetcher = fetch) {
  const driver = env.STORAGE_DRIVER || 'redis';
  if (driver === 'file') {
    if (env.VERCEL || env.NODE_ENV === 'production') throw new Error('File storage is local-only');
    const directory = env.DATA_DIR || join(process.cwd(), '.data');
    const pathFor = key => join(directory, key === 'status' ? 'sync-status.json' : 'schedule.json');
    return {
      async get(key) {
        try { return JSON.parse(await readFile(pathFor(key), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      },
      async set(snapshot, key) {
        await mkdir(directory, { recursive: true });
        const temporary = join(directory, `${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, pathFor(key));
      },
      async acquire(owner) { if (locks.has(directory)) return false; locks.set(directory, owner); return true; },
      async release(owner) { if (locks.get(directory) === owner) locks.delete(directory); }
    };
  }
  if (driver !== 'redis') throw new Error('Unsupported storage driver');
  const url = new URL(env.UPSTASH_REDIS_REST_URL);
  if (url.protocol !== 'https:' || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error('Redis configuration missing');
  async function command(args) {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(8000), redirect: 'error'
    });
    if (!response.ok) throw new Error('Storage unavailable');
    const body = await response.json();
    if (body.error) throw new Error('Storage command failed');
    return body.result;
  }
  const keyFor = key => key === 'status' ? 'school-planner:status:v1' : 'school-planner:schedule:v1';
  const lock = 'school-planner:sync-lock:v1';
  return {
    async get(key) { const value = await command(['GET', keyFor(key)]); return value === null ? null : JSON.parse(value); },
    async set(value, key) { await command(['SET', keyFor(key), JSON.stringify(value)]); },
    async acquire(owner) { return await command(['SET', lock, owner, 'NX', 'EX', 330]) === 'OK'; },
    async release(owner) { await command(['EVAL', 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end', 1, lock, owner]); }
  };
}
