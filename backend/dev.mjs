import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHandlers } from './lib/handlers.js';
import { ArborClient, ArborError } from './lib/arbor.js';
const secret = () => randomBytes(32).toString('hex');
const session = secret();
const env = { ...process.env, ARBOR_USERNAME: process.env.ARBOR_USERNAME || process.env.user, ARBOR_PASSWORD: process.env.ARBOR_PASSWORD || process.env.pass, STORAGE_DRIVER: 'file', DEVICE_TOKEN: secret(), ADMIN_TOKEN: secret(), CRON_SECRET: secret() };
let schoolClient;
let connecting = false;
const handlers = createHandlers({ env, syncClient: () => schoolClient });
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
createServer(async (req, res) => {
  const origin = 'http://127.0.0.1:3000';
  const url = new URL(req.url, origin);
  const send = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  try {
    if (req.headers.host !== '127.0.0.1:3000') return send({ error: 'invalid_host' }, 403);
    if (files[url.pathname] && req.method === 'GET') {
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        ...(url.pathname === '/' ? { 'Set-Cookie': 'planner=' + session + '; HttpOnly; SameSite=Strict; Path=/' } : {}) });
      return res.end(await readFile(new URL('./public/' + file, import.meta.url)));
    }
    if (!req.headers.cookie?.split('; ').includes('planner=' + session)) return send({ error: 'unauthorized' }, 401);
    if (req.method !== 'GET' && req.headers.origin !== origin) return send({ error: 'invalid_origin' }, 403);
    if (url.pathname === '/api/local') return send({ local: true, connected: !!schoolClient?.ready, configured: !!(env.ARBOR_USERNAME && env.ARBOR_PASSWORD), diagnostics: schoolClient?.diagnostics || [] });
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (connecting) return send({ error: 'connect_busy' }, 409);
      connecting = true;
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 8192) return send({ error: 'payload_too_large' }, 413); }
        const { username, password } = JSON.parse(raw);
        const client = new ArborClient({ studentId: process.env.ARBOR_STUDENT_ID || '8408' });
        schoolClient = client;
        await client.login(username, password);
        return send({ connected: true });
      } finally { connecting = false; }
    }
    const handler = { '/api/schedule': handlers.schedule, '/api/status': handlers.status,
      '/api/admin-sync': handlers.adminSync, '/api/import': handlers.import }[url.pathname];
    if (!handler) return send({ error: 'not_found' }, 404);
    const token = ['/api/import', '/api/admin-sync'].includes(url.pathname) ? env.ADMIN_TOKEN : env.DEVICE_TOKEN;
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(url, { method: req.method, headers: { ...req.headers, authorization: 'Bearer ' + token },
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    send(error instanceof ArborError ? { error: error.code, message: error.message } : { error: 'request_failed' }, 502);
  }
}).listen(3000, '127.0.0.1', () => console.log('School Planner simulator: http://127.0.0.1:3000'));

// Background refresh is active only when local server credentials are configured.
if (env.ARBOR_USERNAME && env.ARBOR_PASSWORD) {
  setInterval(() => handlers.adminSync(new Request('http://127.0.0.1:3000/api/admin-sync', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN }
  })).catch(() => {}), 30 * 60 * 1000).unref();
}
