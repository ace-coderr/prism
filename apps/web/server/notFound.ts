/**
 * Any /api/* path that isn't a real endpoint: a plain 404 in JSON (never the app's
 * index.html), never cached. Packaged as a Vercel function by scripts/vercel-output.mjs;
 * served by Vite in dev.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export default function notFound(req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'Not found' }));
}
