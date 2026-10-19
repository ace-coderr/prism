import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeXrayCache, noMoves, type Address, type ReviewableAsset, type XrayCache } from '@prism/core';
import { CREATORS_SELLING_TITLE, CreatorsSellingFeed, creatorsSellingEmpty, watchAgeNote } from '../src/components/feeds';

/*
 * Home's "creators selling their own launch" section disappeared from the live site once: the
 * server answered before the published creator watch had been downloaded, so the feed came back
 * empty, and the page rendered the section only when it had rows. Nothing was broken anywhere, and
 * the whole section was simply gone.
 *
 * Both halves of that are tested here: the server must say it hasn't read the watch rather than
 * quietly answer "nobody is selling", and the section must render whatever the answer is.
 */

const TOKEN = '0x1111111111111111111111111111111111111111' as Address;
const CREATOR = '0x2222222222222222222222222222222222222222' as Address;

const dir = mkdtempSync(join(tmpdir(), 'prism-xray-'));

/** A watch holding one launch whose creator bought 1000 and moved 900 of it out. */
function soldMostFile(): string {
  const cache: XrayCache = {
    chainId: 46630,
    updatedAt: Math.floor(Date.now() / 1000),
    byToken: new Map([
      [
        TOKEN.toLowerCase(),
        {
          token: TOKEN,
          creator: CREATOR,
          moves: { ...noMoves(), acquired: 1000n * 10n ** 18n, movedOut: 900n * 10n ** 18n, firstInBlock: 10, firstOutBlock: 20, biggestOut: 900n * 10n ** 18n, biggestOutBlock: 20 },
          checkedToBlock: 100,
          checkedAt: Math.floor(Date.now() / 1000),
        },
      ],
    ]),
  };
  const path = join(dir, 'good-xray.json.gz');
  writeFileSync(path, gzipSync(JSON.stringify(encodeXrayCache(cache))));
  return path;
}

const asset: ReviewableAsset = { kind: 'launch', token: TOKEN, name: 'Bored App', fullName: null, symbol: 'BOREDAPP', status: null, quote: null, creator: CREATOR, block: 10, gen: null };
const launches = [{ asset, launch: null }];

/** A server with its own module state, so each case starts with nothing loaded. */
async function freshServer(file: string | undefined) {
  vi.resetModules();
  if (file === undefined) delete process.env.LAUNCH_XRAY_FILE;
  else process.env.LAUNCH_XRAY_FILE = file;
  return import('../server/xray');
}

afterEach(() => {
  delete process.env.LAUNCH_XRAY_FILE;
});

describe('the server answering before it has the creator watch', () => {
  it('waits for the file on the very first request, rather than answering empty', async () => {
    const { creatorsSelling } = await freshServer(soldMostFile());
    // the first call, on a cold instance: this used to return no creators at all, because the
    // download was started and never waited for (and a serverless instance stops once it answers)
    const first = await creatorsSelling(launches);
    expect(first.ready).toBe(true);
    expect(first.creators.map((c) => c.symbol)).toEqual(['BOREDAPP']);
    expect(first.creators[0]!.text).toMatch(/BOREDAPP/);
    // the page needs the file's own age to say how old these lines are
    expect(first.updatedAt).toBeGreaterThan(Math.floor(Date.now() / 1000) - 120);
    // and the words are the watch's past tense, not a claim about the chain right now
    expect(first.creators[0]!.text).toMatch(/had sold .* and held /);
    expect(first.creators[0]!.text).not.toMatch(/still holds/);
  });

  it('says it is not ready when the file is missing, instead of "nobody is selling"', async () => {
    const { creatorsSelling } = await freshServer(join(dir, 'not-published-yet.json.gz'));
    expect(await creatorsSelling(launches)).toEqual({ ready: false, updatedAt: 0, creators: [] });
  });

  it('says it is not ready when the file is unreadable', async () => {
    const path = join(dir, 'half-written.json.gz');
    writeFileSync(path, gzipSync(JSON.stringify({ version: 1, rows: [] })).subarray(0, 12)); // a truncated gzip
    const { creatorsSelling } = await freshServer(path);
    expect(await creatorsSelling(launches)).toEqual({ ready: false, updatedAt: 0, creators: [] });
  });

  it('says it is not ready when the file is a format it does not read', async () => {
    const path = join(dir, 'from-the-future.json.gz');
    writeFileSync(path, gzipSync(JSON.stringify({ version: 99, chainId: 46630, rows: [] })));
    const { creatorsSelling } = await freshServer(path);
    expect(await creatorsSelling(launches)).toEqual({ ready: false, updatedAt: 0, creators: [] });
  });

  it('reports the same for the flags on cards', async () => {
    const missing = await freshServer(join(dir, 'nothing-here.json.gz'));
    expect(await missing.cachedFlags([TOKEN])).toEqual({ ready: false, flags: {} });
    const good = await freshServer(soldMostFile());
    const { ready, flags } = await good.cachedFlags([TOKEN]);
    expect(ready).toBe(true);
    expect(flags[TOKEN.toLowerCase()]).toBeTruthy();
  });
});

const render = (props: Parameters<typeof CreatorsSellingFeed>[0]) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CreatorsSellingFeed, props)));

describe('the Home section', () => {
  it('is on the page when the watch has not been read, with a line saying so', () => {
    const html = render({ creators: [], ready: false });
    expect(html).toContain(CREATORS_SELLING_TITLE);
    expect(html).toContain(creatorsSellingEmpty(false));
  });

  it('is on the page before the feed has answered at all', () => {
    expect(render({})).toContain(CREATORS_SELLING_TITLE);
    expect(render({ loading: true })).toContain(CREATORS_SELLING_TITLE);
  });

  it('is on the page when the watch is read and no creator is selling, with a different line', () => {
    const html = render({ creators: [], ready: true });
    expect(html).toContain(CREATORS_SELLING_TITLE);
    expect(html).toContain(creatorsSellingEmpty(true));
    expect(html).not.toContain(creatorsSellingEmpty(false));
  });

  it('tells "not read yet" and "nothing to show" apart', () => {
    expect(creatorsSellingEmpty(false)).not.toEqual(creatorsSellingEmpty(true));
    for (const text of [creatorsSellingEmpty(false), creatorsSellingEmpty(true)]) expect(text.length).toBeGreaterThan(20);
  });

  it('shows the launches when there are some', () => {
    const html = render({
      ready: true,
      creators: [{ token: TOKEN, symbol: 'BOREDAPP', name: 'Bored App', text: 'The creator sold 900M BOREDAPP of the 1B they bought.', movedOut: 0.9, launchBlock: 10 }],
    });
    expect(html).toContain('$BOREDAPP');
    expect(html).toContain('The creator sold 900M BOREDAPP of the 1B they bought.');
    expect(html).toContain(`href="/t/${TOKEN}"`);
    expect(html).not.toContain(creatorsSellingEmpty(true));
    expect(html).not.toContain(creatorsSellingEmpty(false));
  });
});

describe('saying how old these lines are', () => {
  const NOW = Date.UTC(2026, 9, 19, 12);
  const agoHours = (h: number) => Math.floor((NOW - h * 3_600_000) / 1000);

  it('says when the watch was read, and where the live answer is', () => {
    expect(watchAgeNote(agoHours(0.5), NOW)).toBe('As read 30 minutes ago · open a launch for a live read');
    expect(watchAgeNote(agoHours(1), NOW)).toBe('As read 1 hour ago · open a launch for a live read');
    expect(watchAgeNote(agoHours(3), NOW)).toBe('As read 3 hours ago · open a launch for a live read');
  });

  it('says it more plainly once it is hours old', () => {
    const stale = watchAgeNote(agoHours(9), NOW)!;
    expect(stale).toContain('Last read 9 hours ago');
    expect(stale).toContain('may have bought back or sold more since');
    expect(watchAgeNote(agoHours(50), NOW)).toContain('Last read 2 days ago');
  });

  it('says nothing when there is nothing to say', () => {
    expect(watchAgeNote(undefined, NOW)).toBeNull();
    expect(watchAgeNote(0, NOW)).toBeNull();
    expect(watchAgeNote(agoHours(-2), NOW)).toBeNull(); // a clock ahead of ours
  });

  it('never claims the lines are live', () => {
    for (const h of [0.2, 2, 9, 50]) {
      const note = watchAgeNote(agoHours(h), NOW)!;
      expect(note).toMatch(/read/);
      expect(note).not.toMatch(/now|live now|currently/i);
    }
  });

  it('puts the note on the section, next to the rows it describes', () => {
    const creators = [{ token: TOKEN, symbol: 'BOREDAPP', name: 'Bored App', text: 'The creator had sold 63% of the $BOREDAPP they bought (all in one sale) and held 267.3M.', movedOut: 0.63, launchBlock: 10 }];
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CreatorsSellingFeed, { creators, ready: true, updatedAt: agoHours(2), now: NOW })));
    expect(html).toContain('As read 2 hours ago');
    expect(html).toContain('open a launch for a live read');
    // no rows, nothing to date: the empty state carries the meaning instead
    const none = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CreatorsSellingFeed, { creators: [], ready: true, updatedAt: agoHours(2), now: NOW })));
    expect(none).not.toContain('As read 2 hours ago');
  });
});
