import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCrawler, planFor } from '../cloudflare/edge';
// @ts-expect-error a filename with brackets: Pages' catch-all route
import { onRequest } from '../cloudflare/functions/[[path]]';

/*
 * The Cloudflare edge gets 10 ms of CPU a request, so it does one lookup in a file the job wrote and
 * answers. These hold what it answers, and (against the job's real output when it is there) what it costs.
 */

const ADDR = '0x56C3044E212168C8D6517Cc09b0050F5C26aDaCF';
const LOWER = ADDR.toLowerCase();
const BOT = 'Twitterbot/1.0';
const PERSON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36';
const plan = (path: string, ua: string | null = PERSON, method = 'GET') => planFor(new URL(`https://seeprism.pages.dev${path}`), method, ua);

describe('planFor', () => {
  it('gives a crawler the share page of a token or review, and a person the app', () => {
    expect(plan(`/t/${ADDR}`, BOT)).toEqual({ kind: 'share', token: ADDR });
    expect(plan('/r/12', BOT)).toEqual({ kind: 'share-review', id: '12' });
    expect(plan(`/t/${ADDR}`)).toEqual({ kind: 'app' });
    expect(plan('/r/12', null)).toEqual({ kind: 'app' });
  });

  it('knows the badge and the share cards', () => {
    expect(plan(`/badge/${ADDR}.svg`)).toEqual({ kind: 'badge', token: ADDR });
    expect(plan(`/api/og/t/${ADDR}.png`)).toEqual({ kind: 'og', of: 't', id: ADDR });
    expect(plan('/api/og/r/12.png')).toEqual({ kind: 'og', of: 'r', id: '12' });
  });

  it('sends only a real address or review number to a lookup; anything else is the app or a 404', () => {
    for (const junk of ['/t/anything', '/t/0x123', `/t/${ADDR}/more`, '/r/abc', '/r/', '/r/12345678901', '/t/../../etc/passwd']) expect(plan(junk, BOT), junk).toEqual({ kind: 'app' });
    for (const junk of ['/badge/nope.svg', `/badge/${ADDR}.png`, '/badge/' + ADDR]) expect(plan(junk), junk).toEqual({ kind: 'app' });
    for (const junk of ['/api/nothing', '/api/feed', '/api/token?address=' + ADDR, '/api/og/t/nope.png', '/api/og/x/1.png', '/api/', '/api']) expect(plan(junk), junk).toEqual({ kind: 'notfound' });
    expect(plan('/leaderboards')).toEqual({ kind: 'app' });
  });

  it('answers GET and HEAD only', () => {
    expect(plan('/api/feed', PERSON, 'POST')).toEqual({ kind: 'method' });
    expect(plan(`/badge/${ADDR}.svg`, PERSON, 'HEAD').kind).toBe('badge');
  });

  it('recognises link-preview crawlers and no browser', () => {
    for (const bot of ['facebookexternalhit/1.1', 'Mozilla/5.0 (compatible; Discordbot/2.0)', 'Slackbot-LinkExpanding 1.0', 'TelegramBot (like TwitterBot)', 'WhatsApp/2.23', 'Mozilla/5.0 (compatible; Googlebot/2.1)']) expect(isCrawler(bot), bot).toBe(true);
    expect(isCrawler(PERSON)).toBe(false);
    expect(isCrawler('Mozilla/5.0 (iPhone) Mobile/15E148 Line/14.2.0')).toBe(false);
    expect(isCrawler(null)).toBe(false);
  });
});

// ------------------------------------------------------------------ the function, with a stand-in for the files

const INDEX = '<!doctype html><html><head><title>PRISM — see every launch’s true colors</title><meta name="description" content="x" /><meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:url" content="x" /><meta property="og:image" content="x" /><meta property="og:image:type" content="image/jpeg" /><meta property="og:image:alt" content="x" /><meta name="twitter:title" content="x" /><meta name="twitter:description" content="x" /><meta name="twitter:image" content="x" /><meta name="twitter:image:alt" content="x" /></head><body><div id="root"></div></body></html>';

function fakeAssets(files: Record<string, { type: string; body: string }>) {
  const asked: string[] = [];
  return {
    asked,
    fetch: async (r: Request) => {
      const p = new URL(r.url).pathname;
      asked.push(p);
      const f = p === '/index.html' ? { type: 'text/html', body: INDEX } : files[p];
      // as Pages does: a path with no file is the app's own page
      return f ? new Response(f.body, { headers: { 'content-type': f.type } }) : new Response(INDEX, { headers: { 'content-type': 'text/html' } });
    },
  };
}
const row = (token: string, name: string, symbol: string) => JSON.stringify([[token, name, symbol, '', 'eth', 'ETH', '0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002', 6, 1, 100, 1, 0]]);

describe('the Pages Function', () => {
  const store = new Map<string, Response>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('caches', { default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const run = async (files: Record<string, { type: string; body: string }>, path: string, ua = PERSON, method = 'GET') => {
    const waits: Promise<unknown>[] = [];
    const assets = fakeAssets(files);
    const res = await onRequest({ request: new Request(`https://seeprism.pages.dev${path}`, { method, headers: { 'user-agent': ua } }), env: { ASSETS: assets }, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
    await Promise.all(waits);
    return { res, assets };
  };
  const token = { asset: { token: ADDR, symbol: 'PRISM', name: 'Prism', kind: 'launch' }, score: { score: 4.2, reviewers: 5, sold: 0, confidence: 'ok', total: 5 } };

  it('gives a crawler the token’s own title, description and card, taken from its file', async () => {
    const { res } = await run({ [`/data/token/${LOWER}.json`]: { type: 'application/json', body: JSON.stringify(token) }, [`/data/og/t/${LOWER}.png`]: { type: 'image/png', body: 'png' } }, `/t/${ADDR}`, BOT);
    const page = await res.text();
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(page).toContain('<title>$PRISM true colors: 4.2 from 5 holders · PRISM</title>');
    expect(page).toContain(`content="https://seeprism.xyz/data/og/t/${LOWER}.png"`);
    expect(page).toContain('content="image/png"');
    expect(page).toContain('<div id="root">');
  });

  it('names an unreviewed launch from its row in the launch file, with the site’s card', async () => {
    const { res } = await run({ [`/data/l/56.json`]: { type: 'application/json', body: row(ADDR, 'Prism', 'PRISM') } }, `/t/${ADDR}`, BOT);
    const page = await res.text();
    expect(page).toContain('<title>$PRISM on PRISM: reviews from real holders</title>');
    expect(page).toContain('content="https://seeprism.xyz/og.jpg"');
  });

  it('serves the plain page for a launch the files don’t have, rather than an error or a wrong one', async () => {
    const { res } = await run({ '/data/l/56.json': { type: 'application/json', body: row('0x56aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Other', 'OTH') } }, `/t/${ADDR}`, BOT);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(INDEX);
  });

  it('gives a crawler a review’s own words', async () => {
    const review = { review: { id: 7, rating: 5, symbol: 'MOON', text: 'Still holding & <happy>', state: { kind: 'holding' } } };
    const { res } = await run({ '/data/review/7.json': { type: 'application/json', body: JSON.stringify(review) } }, '/r/7', BOT);
    const page = await res.text();
    expect(page).toContain('A 5-star review of $MOON by someone who holds it');
    expect(page).toContain('Still holding &amp; &lt;happy&gt;'); // escaped, never raw
    expect(page).not.toContain('<happy>');
  });

  it('gives a person the app and reads no file for it', async () => {
    const { res, assets } = await run({}, `/t/${ADDR}`, PERSON);
    expect(await res.text()).toBe(INDEX);
    expect(assets.asked).toEqual(['/index.html']);
  });

  it('draws the badge from the token’s file, or from its launch row with no score yet', async () => {
    const a = await run({ [`/data/token/${LOWER}.json`]: { type: 'application/json', body: JSON.stringify(token) } }, `/badge/${ADDR}.svg`);
    expect(a.res.headers.get('content-type')).toContain('image/svg+xml');
    expect(await a.res.text()).toMatch(/PRISM on PRISM: 4\.2|\$PRISM on PRISM/);
    store.clear();
    const b = await run({ '/data/l/56.json': { type: 'application/json', body: row(ADDR, 'Prism', 'PRISM') } }, `/badge/${ADDR}.svg`);
    expect(b.res.status).toBe(200);
    expect(await b.res.text()).toContain('$PRISM');
    store.clear();
    const c = await run({}, `/badge/${ADDR}.svg`);
    expect(c.res.status).toBe(404);
  });

  it('serves the drawn share card, or the site’s own, and a 404 for the old API', async () => {
    const card = await run({ [`/data/og/t/${LOWER}.png`]: { type: 'image/png', body: 'PNGDATA' } }, `/api/og/t/${ADDR}.png`);
    expect(await card.res.text()).toBe('PNGDATA');
    expect(card.res.headers.get('content-type')).toBe('image/png');
    const none = await run({ '/og.jpg': { type: 'image/jpeg', body: 'JPG' } }, `/api/og/t/${ADDR}.png`);
    expect(await none.res.text()).toBe('JPG');
    const old = await run({}, '/api/feed');
    expect(old.res.status).toBe(404);
    expect(await old.res.json()).toEqual({ error: 'Not found' });
    expect((await run({}, '/api/feed', PERSON, 'POST')).res.status).toBe(405);
  });

  it('keeps a share page it has made, and reads the files once', async () => {
    const files = { [`/data/token/${LOWER}.json`]: { type: 'application/json', body: JSON.stringify(token) } };
    const first = await run(files, `/t/${ADDR}`, BOT);
    expect(first.assets.asked.length).toBeGreaterThan(1);
    const second = await run(files, `/t/${ADDR}`, BOT);
    expect(second.assets.asked).toEqual([]);
    expect(await second.res.text()).toContain('$PRISM true colors');
  });
});

// ------------------------------------------------------------------ against what the job really wrote

const DATA = join(import.meta.dirname, '../cloudflare/data');
describe.skipIf(!existsSync(join(DATA, 'info.json')))('on the job’s real output', () => {
  beforeEach(() => vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } }));
  afterEach(() => vi.unstubAllGlobals());
  const assets = {
    fetch: async (r: Request) => {
      const p = new URL(r.url).pathname;
      const file = join(DATA, p.replace(/^\/data\//, ''));
      if (p.startsWith('/data/') && existsSync(file)) return new Response(readFileSync(file), { headers: { 'content-type': p.endsWith('.png') ? 'image/png' : 'application/json' } });
      return new Response(INDEX, { headers: { 'content-type': 'text/html' } });
    },
  };
  const cpuOf = async (path: string, ua: string) => {
    const t0 = process.cpuUsage();
    const res = await onRequest({ request: new Request(`https://seeprism.pages.dev${path}`, { headers: { 'user-agent': ua } }), env: { ASSETS: assets }, waitUntil: () => {} });
    const body = await res.text();
    const c = process.cpuUsage(t0);
    return { res, body, ms: (c.user + c.system) / 1000 };
  };

  it('answers for $PRISM, an unreviewed launch and a stock within the 10 ms a request gets', async () => {
    const info = JSON.parse(readFileSync(join(DATA, 'info.json'), 'utf8'));
    await cpuOf(`/t/${ADDR}`, BOT); // the first call loads the code
    const unreviewed = JSON.parse(readFileSync(join(DATA, 'l', '56.json'), 'utf8'))[0];
    const cases: Array<[string, string]> = [
      [`/t/${ADDR}`, '$PRISM'],
      [`/badge/${ADDR}.svg`, 'PRISM'],
      [`/t/${unreviewed[0]}`, `$${unreviewed[2]}`],
      [`/badge/${unreviewed[0]}.svg`, `$${unreviewed[2]}`],
    ];
    for (const [path, expected] of cases) {
      // the best of five: CPU time is measured for the whole process, so one run can include the rest of a busy suite
      const runs = [];
      for (let i = 0; i < 5; i++) runs.push(await cpuOf(path, BOT));
      const best = Math.min(...runs.map((r) => r.ms));
      expect(runs[0]!.res.status, path).toBe(200);
      expect(runs[0]!.body, path).toContain(expected);
      // Workers allow 10 ms; Node here is no faster than they are
      expect(best, `${path} took ${best.toFixed(1)} ms of CPU at best`).toBeLessThan(10);
    }
    expect(info.launches).toBeGreaterThan(1000);
  });
});
