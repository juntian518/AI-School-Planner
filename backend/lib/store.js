import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export function createStore(env = process.env, fetcher = fetch) {
  const driver = env.STORAGE_DRIVER || 'redis';
  if (driver === 'file') {
    if (env.VERCEL || env.NODE_ENV === 'production') throw new Error('File storage is local-only');
    const directory = env.DATA_DIR || join(process.cwd(), '.data');
    const path = join(directory, 'schedule.json');
    return {
      async get() {
        try { return JSON.parse(await readFile(path, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      },
      async set(snapshot) {
        await mkdir(directory, { recursive: true });
        const temporary = join(directory, `${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, path);
      }
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
  const key = 'school-planner:schedule:v1';
  return {
    async get() { const value = await command(['GET', key]); return value === null ? null : JSON.parse(value); },
    async set(value) { await command(['SET', key, JSON.stringify(value)]); }
  };
}
