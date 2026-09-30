import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createHandlers } from './lib/handlers.js';
const handlers = createHandlers();
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:3000');
    const handler = { '/api/schedule': handlers.schedule, '/api/import': handlers.import, '/api/sync': handlers.sync }[url.pathname];
    if (!handler) {
      res.writeHead(url.pathname === '/' ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('AI School Planner development server\nGET /api/schedule\nPOST /api/import\nGET /api/sync (not connected)\nSee README.md for authentication.');
    }
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(url, {
      method: req.method, headers: req.headers,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {})
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500); res.end('Request failed');
  }
}).listen(3000, '127.0.0.1', () => console.log('School Planner: http://127.0.0.1:3000'));
