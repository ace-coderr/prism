import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { LiveLaunchIndex, TESTNET_TOKENS, allAssets, applyScan, emptyIndex, quotesNeedingSymbols, type DecodedLaunch, type Graduation, type LaunchIndex, type ScanResult } from '../src';

/*
 * LiveLaunchIndex must always hold exactly what applyScan + allAssets would give for the same
 * scans: it exists only to avoid rebuilding 257,000 entries on every refresh. Randomised scans
 * (new launches in and out of order, repeats, graduations by token and by curve, unknown ones, names
 * read later, quote symbols arriving after the launch) are run through both and compared.
 */

// plain lower-case addresses: checksumming 100k of them would dominate the timing test
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const STOCK = TESTNET_TOKENS[0]!.address as Address;

/** A small deterministic random source. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

let counter = 0x1000;
function launch(r: () => number, block: number, over: Partial<DecodedLaunch> = {}): DecodedLaunch {
  const n = counter++;
  const quoteChoice = r();
  return {
    token: A(n),
    name: r() < 0.7 ? `Name ${n}` : null,
    symbol: r() < 0.7 ? `S${n}` : null,
    quote: quoteChoice < 0.4 ? null : quoteChoice < 0.6 ? STOCK : A(0xf00000 + Math.floor(r() * 4)), // ETH, a test stock, or some other token
    creator: A(0xc0000 + (n % 7)),
    curve: A(0x500000 + n),
    gen: 6,
    launchId: n,
    block,
    logIndex: n, // unique, as on a chain: a block and log index name one event
    ...over,
  };
}

/** The index as the scheduled job publishes it: every quote asset's symbol already read. */
function published(index: LaunchIndex): LaunchIndex {
  const symbols = Object.fromEntries(quotesNeedingSymbols(index).map((a) => [a.toLowerCase(), `Q${a.slice(-2)}`]));
  return applyScan(index, { fromBlock: 0, toBlock: index.toBlock, launches: [], graduations: [] }, new Map(), symbols, 1);
}

const scanOf = (launches: DecodedLaunch[], graduations: Graduation[], toBlock: number): ScanResult => ({ fromBlock: toBlock - 10, toBlock, launches, graduations });

function same(live: LiveLaunchIndex, ref: LaunchIndex, label: string) {
  expect(live.index.launches, `${label}: launches`).toEqual(ref.launches);
  expect(live.index.toBlock, `${label}: toBlock`).toBe(ref.toBlock);
  expect(live.index.quoteSymbols, `${label}: quote symbols`).toEqual(ref.quoteSymbols);
  const assets = allAssets(ref);
  expect(live.assets, `${label}: assets`).toEqual(assets);
  expect(live.fromScratch(), `${label}: assets from scratch`).toEqual(assets);
  expect(live.assetByToken.size).toBe(assets.length);
  for (const a of assets) expect(live.assetByToken.get(a.token.toLowerCase()), `${label}: asset ${a.symbol}`).toBe(live.assets.find((x) => x.token === a.token));
  expect(live.launchByToken.size).toBe(ref.launches.length);
  for (const l of ref.launches) expect(live.launchByToken.get(l.token.toLowerCase())).toEqual(l);
}

describe('LiveLaunchIndex', () => {
  it('starts as allAssets of the index it is built from', () => {
    const r = rng(1);
    let ref = emptyIndex(46630, 100);
    ref = published(applyScan(ref, scanOf(Array.from({ length: 60 }, (_, i) => launch(r, 200 + i * 3)), [], 400), new Map(), {}, 1));
    same(new LiveLaunchIndex(ref), ref, 'initial');
  });

  it('follows applyScan + allAssets through many random scans', () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const r = rng(seed);
      let block = 1000;
      let ref = published(applyScan(emptyIndex(46630, 100), scanOf(Array.from({ length: 80 }, (_, i) => launch(r, 200 + i * 5)), [], 900), new Map(), {}, 1));
      const live = new LiveLaunchIndex(ref);
      for (let step = 0; step < 40; step++) {
        const fresh = Array.from({ length: Math.floor(r() * 4) }, () => launch(r, block + Math.floor(r() * 10)));
        // sometimes a launch from before the last one (out of order), and sometimes a repeat of one we have
        if (r() < 0.25) fresh.push(launch(r, 300 + Math.floor(r() * 400)));
        if (r() < 0.25 && ref.launches.length) {
          const old = ref.launches[Math.floor(r() * ref.launches.length)]!;
          fresh.push({ ...old, name: 'Renamed', symbol: 'RENAMED', graduatedBlock: undefined } as unknown as DecodedLaunch);
        }
        const everyone = [...ref.launches, ...fresh.map((f) => ({ ...f, name: f.name ?? '', symbol: f.symbol ?? '' }))];
        const graduations: Graduation[] = [];
        for (let g = 0; g < Math.floor(r() * 3); g++) {
          const pick = everyone[Math.floor(r() * everyone.length)]!;
          const gradAt = block + Math.floor(r() * 50);
          graduations.push(r() < 0.5 ? { by: 'token', token: pick.token, block: gradAt } : { by: 'curve', curve: pick.curve, block: gradAt });
        }
        if (r() < 0.2) graduations.push({ by: 'token', token: A(0xdead00), block: block + 1 }); // one the index doesn't know
        block += 12;
        const scan = scanOf(fresh, graduations, block);
        // names read from the tokens for launches whose event didn't carry them
        const names = new Map(fresh.filter((f) => f.name === null || f.symbol === null).map((f) => [f.token.toLowerCase(), { name: `Read ${f.launchId}`, symbol: `R${f.launchId}` }]));

        ref = applyScan(ref, scan, names, {}, 5);
        const added = live.apply(scan, names, 5);
        // quote tokens whose symbol is read once the launches are in
        const need = quotesNeedingSymbols(ref);
        const symbols = Object.fromEntries(need.map((a) => [a.toLowerCase(), `Q${a.slice(-2)}`]));
        if (need.length) {
          ref = applyScan(ref, { ...scan, launches: [], graduations: [] }, new Map(), symbols, 5);
          live.setQuoteSymbols(symbols, added);
        }
        expect(live.quotesNeedingSymbols(added).sort()).toEqual(need.filter((a) => added.some((l) => l.quote?.toLowerCase() === a.toLowerCase())).sort());
        same(live, ref, `seed ${seed} step ${step}`);
      }
    }
  });

  it('a scan with nothing in it changes nothing but how far it has read', () => {
    const r = rng(7);
    const ref = published(applyScan(emptyIndex(46630, 100), scanOf(Array.from({ length: 20 }, (_, i) => launch(r, 200 + i)), [], 300), new Map(), {}, 1));
    const live = new LiveLaunchIndex(ref);
    const [assets, launches, byToken] = [live.assets, live.index.launches, live.assetByToken];
    live.advanceTo(999);
    expect(live.apply(scanOf([], [], 1200), new Map(), 9)).toEqual([]);
    // the same arrays and maps, not rebuilt
    expect(live.assets).toBe(assets);
    expect(live.index.launches).toBe(launches);
    expect(live.assetByToken).toBe(byToken);
    expect(live.index.toBlock).toBe(1200);
  });

  it('puts a new launch first among the launches, after the stocks, and a graduation updates it in place', () => {
    const r = rng(9);
    const ref = published(applyScan(emptyIndex(46630, 100), scanOf(Array.from({ length: 5 }, (_, i) => launch(r, 200 + i * 10)), [], 300), new Map(), {}, 1));
    const live = new LiveLaunchIndex(ref);
    const nl = launch(r, 500, { name: 'Newest', symbol: 'NEW', quote: null });
    live.apply(scanOf([nl], [], 510), new Map(), 2);
    const firstLaunch = live.assets.findIndex((a) => a.kind === 'launch');
    expect(live.assets[firstLaunch]!.symbol).toBe('NEW');
    expect(live.assets.slice(0, firstLaunch).every((a) => a.kind === 'stock')).toBe(true);
    live.apply(scanOf([], [{ by: 'token', token: nl.token, block: 520 }], 530), new Map(), 3);
    expect(live.assetByToken.get(nl.token.toLowerCase())).toMatchObject({ symbol: 'NEW', status: 'graduated' });
    expect(live.assets[firstLaunch]).toBe(live.assetByToken.get(nl.token.toLowerCase()));
    expect(live.launchByToken.get(nl.token.toLowerCase())!.graduatedBlock).toBe(520);
  });

  it('is cheap: a refresh with a new launch does not touch every launch', () => {
    const r = rng(3);
    const big = published(applyScan(emptyIndex(46630, 100), scanOf(Array.from({ length: 30_000 }, (_, i) => launch(r, 200 + i)), [], 40_000), new Map(), {}, 1));
    const live = new LiveLaunchIndex(big);
    const started = performance.now();
    for (let i = 0; i < 20; i++) live.apply(scanOf([launch(r, 50_000 + i)], [], 50_100 + i), new Map(), 2);
    // 20 refreshes of a 30,000-launch index: milliseconds each, where a rebuild is hundreds
    expect((performance.now() - started) / 20).toBeLessThan(15);
    expect(live.index.launches.length).toBe(30_020);
  });
});
