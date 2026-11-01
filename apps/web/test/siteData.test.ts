import { beforeEach, describe, expect, it, vi } from 'vitest';
import { launchRow, type Launch, type LaunchShardRow } from '@prism/core';

/*
 * The browser reads the site's data from static files. These hold how it reads them: a missing file
 * isn't mistaken for a page, a token is found in the one file that holds it, search looks in the file
 * its first word belongs to (and in the split ones), and what isn't there is a 404, not a crash.
 */

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const launch = (n: number, name: string, symbol: string, graduated = 0): LaunchShardRow =>
  launchRow({ token: A(n), name, symbol, quote: null, creator: A(1), curve: A(2), gen: 6, launchId: n, block: 1000 + n, logIndex: n, graduatedBlock: graduated || null } as Launch, { quote: { kind: 'eth', symbol: 'ETH', address: null } });

const EMPTY = { score: null, reviewers: 0, sold: 0, confidence: 'none', total: 0 };
let files: Record<string, unknown> = {};
let asked: string[] = [];

beforeEach(() => {
  asked = [];
  files = {
    'info.json': { builtAt: 1, indexBlock: 5000, indexGeneratedAt: 1, launches: 4, reviewsBlock: 5000, stale: false, reviewed: [], emptyScore: EMPTY },
    // the launches: a thousand to a file, by the first two hex digits of the address
    'l/00.json': [launch(0xab01, 'Moon Cat', 'MCAT'), launch(0xcd02, 'Moon Dog', 'MDOG', 1500)],
    // search: the file for "mo", and a common start ("vi") split by its third letter
    's/mo.json': [launch(0xab01, 'Moon Cat', 'MCAT'), launch(0xcd02, 'Moon Dog', 'MDOG', 1500)],
    's/mc.json': [launch(0xab01, 'Moon Cat', 'MCAT')],
    's/vi.json': { split: true, top: [launch(0xee05, 'Vibe Newest', 'VNEW')] },
    's/vib.json': [launch(0xee05, 'Vibe Newest', 'VNEW'), launch(0xee06, 'Vibe Older', 'VOLD')],
    's/a_.json': [launch(0xaa07, 'A', 'A')],
    'scores.json': { [A(0xab01)]: { reviews: 3, score: { ...EMPTY, score: 4.2, reviewers: 3 } } },
    'review/7.json': { review: { id: 7, symbol: 'MCAT' } },
    [`reviewer/${A(0x77)}.json`]: { summary: { address: A(0x77) }, reviews: [{ id: 7 }] },
    'feed.json': { latest: [], creatorsSelling: [], creatorWatchReady: true, creatorWatchUpdatedAt: 1 },
  };
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).replace(/^\/data\//, '');
    asked.push(path);
    // as Cloudflare Pages does: a path with no file is the app's own page, status 200
    if (!(path in files)) return new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

const site = () => import('../src/data/site');

describe('reading the files', () => {
  it('counts only JSON as a file: a missing one is none, not the app’s page', async () => {
    const { staticJson } = await site();
    expect(await staticJson('feed.json')).toMatchObject({ creatorWatchReady: true });
    expect(await staticJson('token/0xnothere.json')).toBeNull();
  });

  it('keeps a file it has read, so one page doesn’t fetch the same launch file twice', async () => {
    const { findLaunch } = await site();
    await findLaunch(A(0xab01));
    await findLaunch(A(0xcd02));
    expect(asked.filter((p) => p === 'l/00.json')).toHaveLength(1);
  });

  it('says so when the files can’t be reached at all', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    const { getFeed } = await site();
    await expect(getFeed()).rejects.toMatchObject({ status: 503 });
  });
});

describe('finding a launch', () => {
  it('reads the one file its address belongs to, in any letter case, and builds the launch and its asset', async () => {
    const { findLaunch } = await site();
    const a = await findLaunch(A(0xab01).toUpperCase().replace('0X', '0x'));
    expect(a?.asset).toMatchObject({ kind: 'launch', symbol: 'MCAT', name: 'Moon Cat', status: 'curve' });
    expect(a?.launch).toMatchObject({ token: A(0xab01), curve: A(2), graduatedBlock: null });
    expect((await findLaunch(A(0xcd02)))?.asset.status).toBe('graduated');
  });

  it('finds the test stocks without any file, and says nothing is there for an address it doesn’t know', async () => {
    const { findLaunch } = await site();
    const { reviewableStocks } = await import('@prism/core');
    const nvda = reviewableStocks().find((s) => s.symbol === 'NVDA')!;
    expect((await findLaunch(nvda.token))?.asset.kind).toBe('stock');
    expect(asked).toEqual([]);
    expect(await findLaunch(A(0x0099))).toBeNull();
  });
});

describe('search', () => {
  it('looks in the file of the first word typed and ranks as the server did', async () => {
    const { search } = await site();
    const r = await search('moon');
    expect(r.items.map((i) => i.symbol)).toEqual(expect.arrayContaining(['MCAT', 'MDOG']));
    // the reviewed one carries its count and score
    expect(r.items.find((i) => i.symbol === 'MCAT')).toMatchObject({ reviews: 3, score: { score: 4.2 } });
    expect(r.items.find((i) => i.symbol === 'MDOG')).toMatchObject({ reviews: 0, score: null });
    expect(asked).toContain('s/mo.json');
    expect(asked).not.toContain('s/vi.json');
  });

  it('ignores a $ and the case, and finds a ticker', async () => {
    const { search } = await site();
    expect((await search('$MCAT')).items[0]?.symbol).toBe('MCAT');
    expect((await search('  MoOn  ')).items.length).toBeGreaterThan(0);
  });

  it('reads a split file’s third-letter file once enough is typed, and shows the newest before', async () => {
    const { search } = await site();
    const early = (await search('vi')).items.map((i) => i.symbol);
    expect(early).toContain('VNEW');
    expect(early).not.toContain('VOLD'); // only the newest are here until a third letter is typed
    expect(asked).not.toContain('s/vib.json');
    expect((await search('vibe')).items.map((i) => i.symbol).sort()).toEqual(expect.arrayContaining(['VNEW', 'VOLD']));
    expect(asked).toContain('s/vib.json');
  });

  it('finds a one-letter symbol, an address and an address start', async () => {
    const { search } = await site();
    expect((await search('a')).items.map((i) => i.symbol)).toContain('A');
    expect((await search(A(0xab01))).items.map((i) => i.symbol)).toEqual(['MCAT']);
    expect((await search(A(0xab01).slice(0, 8))).items.map((i) => i.symbol)).toEqual(expect.arrayContaining(['MCAT']));
  });

  it('returns nothing, without reading a file, for nothing or far too much', async () => {
    const { search } = await site();
    expect((await search('   ')).items).toEqual([]);
    expect((await search('x'.repeat(200))).items).toEqual([]);
    expect(asked.filter((p) => p.startsWith('s/'))).toEqual([]);
  });

  it('always offers the test stocks that match', async () => {
    const { search } = await site();
    expect((await search('nvda')).items.some((i) => i.kind === 'stock' && i.symbol === 'NVDA')).toBe(true);
  });
});

describe('reviews and reviewers', () => {
  it('serves a review, and a 404 for one that isn’t there or isn’t a number', async () => {
    const { getReview } = await site();
    expect((await getReview('7')).review).toMatchObject({ id: 7 });
    await expect(getReview('999')).rejects.toMatchObject({ status: 404 });
    await expect(getReview('../info')).rejects.toMatchObject({ status: 404 });
    expect(asked.some((p) => p.includes('..'))).toBe(false);
  });

  it('serves a reviewer by address in any case, and an empty one for someone who has reviewed nothing', async () => {
    const { getReviewer } = await site();
    expect((await getReviewer(A(0x77).toUpperCase().replace('0X', '0x'))).reviews).toHaveLength(1);
    expect(await getReviewer(A(0x88))).toEqual({ summary: null, reviews: [] });
    await expect(getReviewer('nope')).rejects.toMatchObject({ status: 400 });
  });

  it('serves the flags for the tokens asked about, and no others', async () => {
    files['flags.json'] = { [A(1)]: 'Creator sold out', [A(2)]: 'Creator sold 60% of their bag' };
    const { getXrayFlags } = await site();
    expect(await getXrayFlags([A(1).toUpperCase().replace('0X', '0x'), A(3)])).toEqual({ flags: { [A(1)]: 'Creator sold out' } });
  });
});
