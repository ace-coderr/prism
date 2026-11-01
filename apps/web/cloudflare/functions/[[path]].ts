/**
 * The site's edge on Cloudflare Pages. Runs only for the paths in _routes.json (/api, /badge, /t, /r);
 * everything else is a static file, which is free and unlimited. See ../edge.ts for what it decides
 * and ../README.md for why the data routes stay at the origin.
 */
import { DEFAULT_ORIGIN, JSON_404, passHeaders, planFor, ttlSeconds } from '../edge';

interface Env {
  /** where the data routes run (no trailing slash); the Vercel deployment's own address */
  ORIGIN_URL?: string;
  /** a secret shared with the origin (its EDGE_KEY): lets the origin count requests by visitor, not by Cloudflare address */
  EDGE_KEY?: string;
  /** the static app, from this deployment */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface Ctx {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}

// workers-types would say so; this file needs just this much of it
declare const caches: { default: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };

const tag = (res: Response, how: string) => {
  const out = new Response(res.body, res);
  out.headers.set('x-prism-edge', how);
  return out;
};

export const onRequest = async ({ request, env, waitUntil }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  const plan = planFor(url, request.method, request.headers.get('user-agent'));

  if (plan.kind === 'method') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  if (plan.kind === 'notfound') return new Response(JSON_404, { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  // the static app (index.html), for a page route a person opened and any path with no file
  if (plan.kind === 'app') return tag(await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: request.method })), 'app');

  // answered here if this data centre already has it
  const key = new Request(`${url.origin}${plan.path}`, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return tag(hit, 'hit');

  const origin = (env.ORIGIN_URL ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  let res: Response;
  try {
    const headers: Record<string, string> = { accept: request.headers.get('accept') ?? '*/*' };
    const visitor = request.headers.get('cf-connecting-ip');
    if (env.EDGE_KEY && visitor) Object.assign(headers, { 'x-prism-client': visitor, 'x-prism-edge': env.EDGE_KEY });
    res = await fetch(`${origin}${plan.path}`, { method: 'GET', headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Data isn’t available right now. Try again in a minute.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const headers = passHeaders(res.headers);
  headers.set('x-prism-edge', 'miss');
  // small bodies (JSON, a share card, a 96-pixel picture): read whole so one copy can be kept and one served
  const body = await res.arrayBuffer();
  const ttl = ttlSeconds(res.headers.get('cache-control'), res.status);
  if (ttl > 0) {
    const kept = new Headers(headers);
    kept.set('cache-control', `public, max-age=${ttl}`);
    waitUntil(caches.default.put(key, new Response(body, { status: res.status, headers: kept })));
  }
  return new Response(request.method === 'HEAD' ? null : body, { status: res.status, headers });
};
