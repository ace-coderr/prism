import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCrawler, passHeaders, planFor, ttlSeconds } from '../cloudflare/edge';
// @ts-expect-error a filename with brackets: Pages' catch-all route
import { onRequest } from '../cloudflare/functions/[[path]]';

/*
 * The Cloudflare edge decides what reaches the origin (the Vercel functions) and what is answered
 * here. These hold it to the same rules as the Vercel build: the same routes, valid ids only,
 * crawlers get the share-ready page and people get the app.
 */

const ADDR = '0x56C3044E212168C8D6517Cc09b0050F5C26aDaCF';
const plan = (path: string, ua: string | null = 'Mozilla/5.0 Chrome/130', method = 'GET') => planFor(new URL(`https://seeprism.pages.dev${path}`), method, ua);
const TWITTER = 'Twitterbot/1.0';

describe('planFor', () => {
  it('sends the data routes to the origin with the query the browser sent', () => {
    expect(plan('/api/feed')).toEqual({ kind: 'proxy', path: '/api/data?route=feed' });
    expect(plan('/api/token?address=' + ADDR)).toEqual({ kind: 'proxy', path: `/api/data?route=token&address=${ADDR}` });
    expect(plan('/api/launches?q=moon&limit=8')).toEqual({ kind: 'proxy', path: '/api/data?route=launches&q=moon&limit=8' });
    expect(plan(`/badge/${ADDR}.svg`)).toEqual({ kind: 'proxy', path: `/api/data?route=badge&address=${ADDR}` });
    expect(plan(`/api/og/t/${ADDR}.png`)).toEqual({ kind: 'proxy', path: `/api/og?kind=t&id=${ADDR}` });
    expect(plan('/api/og/r/12.png')).toEqual({ kind: 'proxy', path: '/api/og?kind=r&id=12' });
  });

  it('can’t have its route changed by the query: the route it chose comes first', () => {
    const p = plan('/api/feed?route=badge&address=0x1') as { path: string };
    expect(new URL(p.path, 'https://x').searchParams.get('route')).toBe('feed');
  });

  it('gives a page route to a crawler as the origin’s share-ready page, and to a person as the app', () => {
    expect(plan(`/t/${ADDR}`, TWITTER)).toEqual({ kind: 'page', path: `/api/page?kind=t&id=${ADDR}` });
    expect(plan('/r/12', TWITTER)).toEqual({ kind: 'page', path: '/api/page?kind=r&id=12' });
    expect(plan(`/t/${ADDR}`)).toEqual({ kind: 'app' });
    expect(plan('/r/12', null)).toEqual({ kind: 'app' });
  });

  it('never forwards a path the site doesn’t have', () => {
    for (const junk of ['/api/nothing', '/api/data', '/api/page?kind=t&id=1', '/api/img?token=' + ADDR, '/api/', '/api']) expect(plan(junk), junk).toEqual({ kind: 'notfound' });
    // an invalid id is the app (its own "not a token" page), and never a function run at the origin
    for (const junk of ['/t/anything', '/t/0x123', '/r/abc', `/t/${ADDR}/more`]) expect(plan(junk, TWITTER), junk).toEqual({ kind: 'app' });
    expect(plan('/api/og/t/nope.png')).toEqual({ kind: 'notfound' });
  });

  it('answers GET and HEAD only', () => {
    expect(plan('/api/feed', 'x', 'POST')).toEqual({ kind: 'method' });
    expect(plan('/api/feed', 'x', 'HEAD').kind).toBe('proxy');
  });

  it('recognises link-preview crawlers and no browser', () => {
    expect(isCrawler('facebookexternalhit/1.1')).toBe(true);
    expect(isCrawler('Mozilla/5.0 (compatible; Discordbot/2.0)')).toBe(true);
    expect(isCrawler('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36')).toBe(false);
    expect(isCrawler(null)).toBe(false);
  });
});

describe('ttlSeconds', () => {
  it('keeps an answer for as long as the origin says, and not at all if it says not to', () => {
    expect(ttlSeconds('public, max-age=0, s-maxage=60, stale-while-revalidate=300', 200)).toBe(60);
    expect(ttlSeconds('public, max-age=86400, s-maxage=31536000, immutable', 200)).toBe(31_536_000);
    expect(ttlSeconds('public, max-age=300', 200)).toBe(300);
    expect(ttlSeconds('public, max-age=0', 200)).toBe(0);
    expect(ttlSeconds('no-store', 200)).toBe(0);
    expect(ttlSeconds('public, s-maxage=60, no-store', 200)).toBe(0);
    expect(ttlSeconds('private, max-age=60', 200)).toBe(0);
    expect(ttlSeconds(null, 200)).toBe(0);
    // never an error, and never longer than a year
    expect(ttlSeconds('public, s-maxage=60', 503)).toBe(0);
    expect(ttlSeconds('public, s-maxage=60', 404)).toBe(0);
    expect(ttlSeconds('public, s-maxage=999999999', 200)).toBe(31_536_000);
  });
});

describe('passHeaders', () => {
  it('drops what is only for one hop, and anything that would set state on a visitor', () => {
    const out = passHeaders(new Headers({ 'content-type': 'image/png', 'cache-control': 'public', 'set-cookie': 'a=b', 'x-vercel-id': 'x', 'content-encoding': 'br', 'x-prism-image': 'metadata' }));
    expect([...out.keys()].sort()).toEqual(['cache-control', 'content-type', 'x-prism-image']);
  });
});

describe('the Pages Function', () => {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const origin: string[] = [];
  let reply: () => Response;

  beforeEach(() => {
    store.clear();
    puts.length = 0;
    origin.length = 0;
    reply = () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=0, s-maxage=60', 'set-cookie': 'x=1', 'x-vercel-id': 'abc' } });
    vi.stubGlobal('caches', {
      default: {
        match: async (r: Request) => store.get(r.url)?.clone(),
        put: async (r: Request, res: Response) => void (puts.push(r.url), store.set(r.url, res)),
      },
    });
    vi.stubGlobal('fetch', async (u: string) => (origin.push(String(u)), reply()));
  });
  afterEach(() => vi.unstubAllGlobals());

  const env = { ORIGIN_URL: 'https://origin.example', ASSETS: { fetch: async () => new Response('<!doctype html>app', { headers: { 'content-type': 'text/html' } }) } };
  const run = async (path: string, init: RequestInit = {}) => {
    const waits: Promise<unknown>[] = [];
    const res = await onRequest({ request: new Request(`https://seeprism.pages.dev${path}`, init), env, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);
    return res;
  };

  it('asks the origin once, then answers the same request from its cache', async () => {
    const a = await run('/api/feed');
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ ok: true });
    expect(a.headers.get('x-prism-edge')).toBe('miss');
    expect(origin).toEqual(['https://origin.example/api/data?route=feed']);
    const b = await run('/api/feed');
    expect(b.headers.get('x-prism-edge')).toBe('hit');
    expect(await b.json()).toEqual({ ok: true });
    expect(origin).toHaveLength(1);
  });

  it('keeps the origin’s own cache header for browsers, and strips what shouldn’t pass', async () => {
    const r = await run('/api/feed');
    expect(r.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('x-vercel-id')).toBeNull();
  });

  it('doesn’t keep what the origin says not to (a fresh read, an error), and asks again', async () => {
    reply = () => new Response('{"a":1}', { status: 200, headers: { 'cache-control': 'no-store' } });
    await run('/api/feed?fresh=143000000');
    await run('/api/feed?fresh=143000000');
    expect(origin).toHaveLength(2);
    reply = () => new Response('{"error":"x"}', { status: 503, headers: { 'cache-control': 'public, s-maxage=60' } });
    await run('/api/token?address=' + ADDR);
    expect((await run('/api/token?address=' + ADDR)).status).toBe(503);
    expect(puts).toEqual([]);
  });

  it('caches each URL separately, so a different query is a different answer', async () => {
    await run('/api/launches?q=moon');
    await run('/api/launches?q=dog');
    await run('/api/launches?q=moon');
    expect(origin).toHaveLength(2);
  });

  it('serves the static app to a person on a page route without asking the origin, and the share page to a crawler', async () => {
    const person = await run(`/t/${ADDR}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/130' } });
    expect(await person.text()).toContain('app');
    expect(origin).toEqual([]);
    reply = () => new Response('<title>$PRISM</title>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, s-maxage=300' } });
    const bot = await run(`/t/${ADDR}`, { headers: { 'user-agent': TWITTER } });
    expect(await bot.text()).toContain('$PRISM');
    expect(origin).toEqual([`https://origin.example/api/page?kind=t&id=${ADDR}`]);
  });

  it('answers a path the site doesn’t have without bothering the origin, and refuses a write', async () => {
    const nf = await run('/api/not-a-route');
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: 'Not found' });
    expect((await run('/api/feed', { method: 'POST', body: '{}' })).status).toBe(405);
    expect(origin).toEqual([]);
  });

  it('says so when the origin can’t be reached, and caches nothing', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('down');
    });
    const r = await run('/api/feed');
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(puts).toEqual([]);
  });

  it('tells the origin who the visitor really is, only when it has the key to say so', async () => {
    let seen: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => ((seen = Object.fromEntries(new Headers(init.headers))), reply()));
    const withKey = { ...env, EDGE_KEY: 'k' };
    const ask = (e: typeof env | typeof withKey, p: string) => onRequest({ request: new Request(`https://seeprism.pages.dev${p}`, { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env: e, waitUntil: () => {} });
    await ask(withKey, '/api/leaderboards');
    expect(seen['x-prism-client']).toBe('203.0.113.7');
    expect(seen['x-prism-edge']).toBe('k');
    await ask(env, '/api/stocks');
    expect(seen['x-prism-client']).toBeUndefined();
    expect(seen['x-prism-edge']).toBeUndefined();
  });

  it('sends nothing of the visitor to the origin but what the route needs', async () => {
    let seen: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => ((seen = Object.fromEntries(new Headers(init.headers))), reply()));
    await run('/api/feed', { headers: { cookie: 'session=secret', authorization: 'Bearer x', accept: 'application/json' } });
    expect(seen).toEqual({ accept: 'application/json' });
  });
});
