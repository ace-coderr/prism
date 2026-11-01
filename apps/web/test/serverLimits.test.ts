import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { encodeXrayCache } from '@prism/core';
import { XRAY_POLLS, xrayPollDelay } from '../src/data/api';
import { Limiter, clientOf } from '../server/limits';

/*
 * The server's CPU is what the site pays for. These hold in place what keeps it from being spent
 * by one client, one bot, or a URL that changes on every request.
 */

// ---- a small, fixed index and no chain: the handler runs against these
vi.mock('../server/launchIndex', async () => {
  const core = await import('@prism/core');
  const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
  const launches = Array.from({ length: 40 }, (_, i) => ({
    token: A(0x1000 + i),
    name: i % 2 ? `Moon Cat ${i}` : `Dog ${i}`,
    symbol: i % 2 ? `MOON${i}` : `DOG${i}`,
    quote: null,
    creator: A(0xc0),
    curve: A(0x5000 + i),
    gen: 6 as const,
    launchId: i,
    block: 1000 + i,
    logIndex: i,
    graduatedBlock: null,
  }));
  const live = new core.LiveLaunchIndex({ version: 2, chainId: 46630, toBlock: 2000, generatedAt: 1, launches, quoteSymbols: {} });
  const view = { index: live.index, stale: false, at: Date.now(), assets: live.assets, assetByToken: live.assetByToken, launchByToken: live.launchByToken };
  return { currentIndex: async () => ({ ...view, at: Date.now() }), assetOf: () => null };
});
vi.mock('../server/reviewState', () => ({
  reviewState: async () => {
    throw new Error('no chain in this test');
  },
}));

const { default: handler, CACHE_CONTROL } = await import('../server/data');
const { creatorsSelling } = await import('../server/xray');
const TOKEN = (n: number) => `0x${(0x1000 + n).toString(16).padStart(40, '0')}`;

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
  json: any;
}
let nextClient = 1;
const fresh = () => `10.0.0.${nextClient++}`;
async function get(path: string, client = fresh(), method = 'GET'): Promise<Reply> {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = String(v)),
    end(b?: string) {
      this.body = b ?? '';
    },
    body: '',
  };
  await handler({ url: path, method, headers: { 'x-forwarded-for': client }, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
  let json: unknown = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, headers, body: res.body, json };
}

describe('Limiter', () => {
  it('lets a client through up to its allowance, then stops it until the window ends', () => {
    const l = new Limiter(3, 60_000);
    expect([1, 2, 3, 4, 5].map(() => l.take('a', 1_000))).toEqual([true, true, true, false, false]);
    expect(l.take('b', 1_000)).toBe(true); // someone else is unaffected
    expect(l.retryAfter('a', 1_000)).toBe(60);
    expect(l.retryAfter('a', 40_000)).toBe(21);
    expect(l.take('a', 61_001)).toBe(true); // a new window
  });

  it('can’t be made to grow without bound by a stream of new clients', () => {
    const l = new Limiter(1, 60_000);
    for (let i = 0; i < 30_000; i++) l.take(`client-${i}`, 1_000);
    expect((l as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(5_000);
  });

  it('knows a client by the address the platform saw', () => {
    const req = (h: Record<string, string | string[]>) => ({ headers: h, socket: { remoteAddress: '9.9.9.9' } }) as never;
    expect(clientOf(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientOf(req({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientOf(req({}))).toBe('9.9.9.9');
  });
});

describe('the data routes', () => {
  it('serve a cached answer for the same URL, and a name that isn’t a route is a 404, not a call', async () => {
    const ok = await get(`/api/launches?token=${TOKEN(3)}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe(CACHE_CONTROL);
    for (const route of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nothing']) {
      const r = await get(`/api/data?route=${route}`);
      expect(r.status, route).toBe(404);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('look a token up by its address, not by scanning every launch', async () => {
    expect((await get(`/api/launches?token=${TOKEN(7)}`)).json.asset.symbol).toBe('MOON7');
    expect((await get('/api/launches?token=0x00000000000000000000000000000000000fffff')).status).toBe(404);
  });

  it('list launches newest first by slicing, and stop paging at a limit', async () => {
    const list = (await get('/api/launches?limit=3')).json;
    expect(list.items.map((a: { symbol: string }) => a.symbol)).toEqual(['MOON39', 'DOG38', 'MOON37']);
    expect(list.stocks).toHaveLength(5);
    const deep = await get('/api/launches?offset=99999999&limit=100');
    expect(deep.status).toBe(200);
    expect(deep.json.items).toEqual([]);
  });

  describe('search', () => {
    it('is capped in length and in how many it returns', async () => {
      expect((await get(`/api/launches?q=${'a'.repeat(81)}`)).status).toBe(400);
      expect((await get(`/api/launches?q=${'a'.repeat(80)}`)).status).toBe(200);
      const many = await get('/api/launches?q=moon&limit=50');
      expect(many.json.items.length).toBe(20);
    });

    it('answers the same text from a cache, so a typed prefix isn’t searched twice', async () => {
      const a = await get('/api/launches?q=Moon%20Cat&limit=8');
      const b = await get('/api/launches?q=moon%20cat&limit=8');
      expect(b.json.items).toEqual(a.json.items);
      expect(a.json.items.length).toBe(8);
    });

    it('stops a client that searches in a loop, with when to come back, and leaves everyone else alone', async () => {
      const me = fresh();
      const codes: number[] = [];
      for (let i = 0; i < 45; i++) codes.push((await get(`/api/launches?q=x${i}`, me)).status);
      expect(codes.slice(0, 40).every((c) => c === 200)).toBe(true);
      expect(codes.slice(40)).toEqual([429, 429, 429, 429, 429]);
      const blocked = await get('/api/launches?q=again', me);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(blocked.headers['cache-control']).toBe('no-store');
      expect((await get('/api/launches?q=moon', fresh())).status).toBe(200);
      // the plain list and a token lookup don't count as searches
      expect((await get('/api/launches?limit=2', me)).status).toBe(200);
    });
  });

  describe('?fresh=', () => {
    it('skips the CDN only for a real block number', async () => {
      for (const p of ['fresh=1', 'fresh=abc', 'fresh=', 'fresh=-5', 'fresh=1e9', `fresh=${'9'.repeat(13)}`]) {
        const r = await get(`/api/launches?limit=1&${p}`);
        expect(r.headers['cache-control'], p).toBe(CACHE_CONTROL);
      }
      expect((await get('/api/launches?limit=1&fresh=143000000')).headers['cache-control']).toBe('no-store');
    });

    it('is allowed so often a minute, then answered like any other request', async () => {
      const me = fresh();
      const seen: string[] = [];
      for (let i = 0; i < 25; i++) seen.push((await get(`/api/launches?limit=1&fresh=${143000000 + i}`, me)).headers['cache-control']!);
      expect(seen.slice(0, 20).every((c) => c === 'no-store')).toBe(true);
      expect(seen.slice(20).every((c) => c === CACHE_CONTROL)).toBe(true);
    });
  });

  it('limit one client’s X-ray reads, so a script can’t keep the server reading launch histories', async () => {
    const me = fresh();
    const codes: number[] = [];
    for (let i = 0; i < 95; i++) codes.push((await get(`/api/xray?token=0x00000000000000000000000000000000000f${(i + 0x1000).toString(16)}`, me)).status);
    expect(codes.filter((c) => c === 429).length).toBe(5);
    expect(codes.slice(0, 90).every((c) => c === 404)).toBe(true); // not in the index: answered without reading anything
    // reading the flags of cards and the list of opened launches isn't a read
    expect((await get('/api/xray?recent=1', me)).status).toBe(200);
  });

  it('only answers GET and HEAD', async () => {
    expect((await get('/api/launches', fresh(), 'POST')).status).toBe(405);
  });
});

describe('creators selling reads the watch’s own rows', () => {
  it('and never the list of every launch', async () => {
    const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
    // a watch with three launches: the creator sold most of two of them
    const row = (n: number, acquired: bigint, out: bigint, block: number) => ({
      token: A(n),
      creator: A(0xc0),
      moves: { acquired, movedOut: out, firstInBlock: block, firstOutBlock: out > 0n ? block + 1 : null, biggestOut: out, biggestOutBlock: out > 0n ? block + 1 : null },
      checkedToBlock: 5000,
      checkedAt: 1,
    });
    const dir = mkdtempSync(join(tmpdir(), 'prism-watch-'));
    const file = join(dir, 'watch.json.gz');
    const cache = { chainId: 46630, updatedAt: 1_700_000_000, byToken: new Map([row(1, 100n, 90n, 1010), row(2, 100n, 10n, 1020), row(3, 100n, 100n, 1030)].map((r) => [r.token, r])) };
    writeFileSync(file, gzipSync(JSON.stringify(encodeXrayCache(cache))));
    process.env.LAUNCH_XRAY_FILE = file;
    const asset = (n: number, kind: 'launch' | 'stock' = 'launch') => ({ kind, token: A(n), name: `Name ${n}`, symbol: `S${n}`, fullName: null, status: null, quote: null, creator: null, block: 1000 + n, gen: 6 as const });
    const lookup = {
      assetByToken: new Map([1, 2, 3].map((n) => [A(n), asset(n)] as const)),
      launchByToken: new Map([[A(1), { block: 1010 }], [A(3), { block: 1030 }]]),
      // a quarter of a million launches would be in here: asking for them is the bug
      get assets(): never {
        throw new Error('iterated every launch');
      },
    };
    try {
      const out = await creatorsSelling(lookup as never);
      expect(out.ready).toBe(true);
      expect(out.updatedAt).toBe(1_700_000_000);
      // newest first, only the ones whose creator sold most (2 sold 10%)
      expect(out.creators.map((c) => c.symbol)).toEqual(['S3', 'S1']);
      expect(out.creators[0]!.text).toMatch(/^The creator sold every/);
      expect(out.creators[1]!.text).toMatch(/had sold 90%/);
    } finally {
      delete process.env.LAUNCH_XRAY_FILE;
    }
  });
});

describe('the route table', () => {
  const table = JSON.parse(readFileSync(new URL('../server/routes.json', import.meta.url), 'utf8')) as {
    crawlers: string;
    routes: Array<{ src: string; dest: string; bots?: boolean }>;
  };
  const hit = (path: string) => table.routes.filter((r) => new RegExp(r.src).test(path));
  const ADDR = '0x56C3044E212168C8D6517Cc09b0050F5C26aDaCF';

  it('sends only a real address or review number to a function: anything else is the static app or a 404', () => {
    expect(hit(`/t/${ADDR}`).map((r) => r.dest)).toEqual([`/api/page?kind=t&id=$1`]);
    expect(hit('/r/12').map((r) => r.dest)).toEqual([`/api/page?kind=r&id=$1`]);
    for (const junk of ['/t/anything', '/t/0x123', '/t/' + ADDR + '/extra', '/r/abc', '/r/', '/r/12345678901', '/t/../../etc/passwd']) expect(hit(junk), junk).toEqual([]);
    expect(hit(`/api/og/t/${ADDR}.png`)).toHaveLength(1);
    expect(hit('/api/og/r/9.png')).toHaveLength(1);
    for (const junk of ['/api/og/t/nope.png', '/api/og/x/1.png', '/api/og/r/1x.png', `/api/og/t/${ADDR}.png/more`]) expect(hit(junk), junk).toEqual([]);
    expect(hit(`/img/t/${ADDR}.png`)).toHaveLength(1);
    expect(hit('/img/t/0xnope.png')).toEqual([]);
  });

  it('shares each page route with link-preview crawlers only, not with people', () => {
    const pages = table.routes.filter((r) => r.dest.startsWith('/api/page'));
    expect(pages).toHaveLength(2);
    expect(pages.every((r) => r.bots === true)).toBe(true);
    // and nothing else is crawler-only by accident
    expect(table.routes.filter((r) => r.bots).length).toBe(2);
  });

  it('recognises the crawlers that read share tags and no browser', () => {
    const re = new RegExp(table.crawlers);
    for (const bot of [
      'Twitterbot/1.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'TelegramBot (like TwitterBot)',
      'WhatsApp/2.23.20.0 A',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 (compatible; Mastodon/4.2.0)',
    ]) {
      expect(re.test(bot), bot).toBe(true);
    }
    for (const person of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.2.0',
    ]) {
      expect(re.test(person), person).toBe(false);
    }
  });
});

describe('the X-ray poll', () => {
  it('backs off, is capped at 30 seconds, and gives up after about five minutes', () => {
    const delays = Array.from({ length: XRAY_POLLS }, (_, i) => xrayPollDelay(i)!);
    expect(delays[0]).toBe(3_000);
    expect(delays.every((d, i) => i === 0 || d >= delays[i - 1]!)).toBe(true);
    expect(Math.max(...delays)).toBe(30_000);
    expect(xrayPollDelay(XRAY_POLLS)).toBeNull();
    expect(xrayPollDelay(500)).toBeNull();
    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(3 * 60_000);
    expect(total).toBeLessThan(7 * 60_000);
  });
});
