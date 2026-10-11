import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAddress, type Address, type PublicClient } from 'viem';
import {
  LAUNCH_INDEX_VERSION,
  allAssets,
  applyScan,
  balancesOf,
  cleanText,
  decodeGraduationLog,
  decodeIndex,
  decodeLaunchLog,
  emptyIndex,
  encodeIndex,
  getLogsSplit,
  lifecycleOf,
  quoteOf,
  quotesNeedingSymbols,
  reviewableStocks,
  scanLaunches,
  searchAssets,
  tokenById,
  tokensNeedingNames,
  type DecodedLaunch,
  type LaunchIndex,
  type RawLog,
  type ScanResult,
} from '../src';

// real logs from Robinhood Chain Testnet (see _source in the file)
const V = JSON.parse(readFileSync(new URL('./vectors/launch-logs.json', import.meta.url), 'utf8')) as Record<string, RawLog & { blockNumber: string; logIndex: string }>;
const log = (k: string): RawLog => ({ ...V[k]!, blockNumber: BigInt(V[k]!.blockNumber), logIndex: Number(V[k]!.logIndex) });

const NVDA = tokenById('NVDA')!.address;
const VIBEVIBE = getAddress('0xf1f6b050550531226ee0257fec4a1e575ff4c341');
const A = (n: number) => getAddress(`0x${n.toString(16).padStart(40, '0')}`);

describe('decoding launch events (real logs)', () => {
  it('gen 1 and gen 2 TokenLaunched: token, curve, creator; ETH-paired; no name in the event', () => {
    const g1 = decodeLaunchLog(log('gen1'))!;
    expect(g1).toMatchObject({ gen: 1, quote: null, name: null, symbol: null, creator: getAddress('0x48cec4e0a1c39a81a481eaedd937190d26b57b79') });
    expect(g1.token).toBe(getAddress(`0x${V.gen1!.topics[2]!.slice(26)}`));
    expect(g1.curve).toBe(getAddress(`0x${V.gen1!.topics[3]!.slice(26)}`));
    const g2 = decodeLaunchLog(log('gen2'))!;
    expect(g2).toMatchObject({
      gen: 2,
      launchId: 0,
      token: getAddress('0x2aae5f5627e75938973e8a3fa666ce79e0f58b18'),
      curve: getAddress('0x20fbd207f0961c03ea4a7849e0f1bc90543c520e'),
      creator: getAddress('0x451a2a4e55b6070a6bd1475fb27fd4a1c81a293b'),
      quote: null,
    });
  });

  it('gen 0 (the first factory) uses the same TokenLaunched event, and its adapter the same PoolGraduated', () => {
    expect(decodeLaunchLog(log('gen0'))).toMatchObject({ gen: 0, quote: null, name: null, token: getAddress('0x932ad386c019f098caa4e4e54a56cfd47410cf77') });
    expect(decodeGraduationLog(log('gradGen0'))).toMatchObject({ by: 'token', token: getAddress('0xd00a6cec79a31a1839490789f6adae18b1597655'), block: 116872583 });
  });

  it('gen 2’s stock-paired launch carries its quote asset', () => {
    expect(decodeLaunchLog(log('gen2quote'))).toMatchObject({
      gen: 2,
      launchId: 0x977,
      token: getAddress('0x30bfa8d160b815c81a45b8bec2cc0dcf8b27b8e3'),
      quote: getAddress('0x5a5398155d98374c0e26265ea3cb9818169c2739'),
      creator: getAddress('0x36b622acf4a445672bc7675224bbbce9d3b01dfd'),
    });
  });

  it('v6: name, symbol, curve, creator and quote (ETH or a test stock) from the event', () => {
    expect(decodeLaunchLog(log('v6eth'))).toMatchObject({
      gen: 6,
      token: VIBEVIBE,
      name: 'VIBEVIBE',
      symbol: 'VIBEVIBE',
      quote: null,
      creator: getAddress('0x463e27522efa028f59e1c153d065b97cdef02495'),
      curve: getAddress('0xe4e8915fe5cf5da424640a0ce48b8a8befeeeb91'),
      block: 126070172,
    });
    expect(decodeLaunchLog(log('v6nvda'))).toMatchObject({ gen: 6, name: 'VIBECHECK', symbol: 'VIBECHECK', quote: NVDA, launchId: 9 });
  });

  it('ignores the same events from any other contract, and other events from the factories', () => {
    expect(decodeLaunchLog({ ...log('v6eth'), address: A(1) })).toBeNull();
    expect(decodeLaunchLog({ ...log('gen1'), address: '0xe794217880011f9cA6961340eD5c16EC9559Fea0' })).toBeNull(); // gen 1 layout at v6
    expect(decodeLaunchLog({ ...log('gen1'), topics: [log('gradLegacy').topics[0]!, ...log('gen1').topics.slice(1)] })).toBeNull();
    expect(decodeLaunchLog({ ...log('v6eth'), data: '0x1234' })).toBeNull();
  });

  it('graduations: PoolGraduated by token from either adapter; v6 by the curve that emitted it', () => {
    expect(decodeGraduationLog(log('gradLegacy'))).toEqual({ by: 'token', token: getAddress('0xc4fc18e331b41a2aa7b410778f8e799cf9e14ffc'), block: 109512463 });
    expect(decodeGraduationLog(log('gradCurrent'))).toMatchObject({ by: 'token', token: getAddress('0x0dca868d08971ebdde344b7797f67ff230bf0ba3') });
    expect(decodeGraduationLog({ ...log('gradLegacy'), address: A(2) })).toBeNull(); // not an adapter
    expect(decodeGraduationLog(log('v6curveGrad'))).toEqual({ by: 'curve', curve: getAddress('0xe4e8915fe5cf5da424640a0ce48b8a8befeeeb91'), block: 126079452 });
    expect(decodeGraduationLog(log('gen1'))).toBeNull();
  });
});

const launch = (o: Partial<DecodedLaunch> & { token: Address }): DecodedLaunch => ({
  name: null,
  symbol: null,
  quote: null,
  creator: A(0xc0),
  curve: getAddress(`0x${'c'.repeat(8)}${o.token.slice(10)}`),
  gen: 1,
  launchId: 0,
  block: 100,
  logIndex: 0,
  ...o,
});
const scan = (launches: DecodedLaunch[], graduations: ScanResult['graduations'] = [], toBlock = 1000): ScanResult => ({ fromBlock: 0, toBlock, launches, graduations });
const base = (): LaunchIndex => emptyIndex(46630, 0);

describe('building the index', () => {
  it('dedupes one token across factory generations and overlapping scans: the earliest launch wins', () => {
    const t = A(0x1111);
    const v6 = launch({ token: t, gen: 6, block: 500, name: 'Late', symbol: 'LATE' });
    const g1 = launch({ token: t, gen: 1, block: 200 });
    let i = applyScan(base(), scan([v6]));
    i = applyScan(i, scan([g1]), new Map([[t.toLowerCase(), { name: 'Early', symbol: 'ERL' }]]));
    expect(i.launches).toHaveLength(1);
    expect(i.launches[0]).toMatchObject({ gen: 1, block: 200, name: 'Early', symbol: 'ERL' });
    // re-scanning the same blocks changes nothing
    const again = applyScan(i, scan([v6, g1]), new Map([[t.toLowerCase(), { name: 'Early', symbol: 'ERL' }]]));
    expect(again.launches).toEqual(i.launches);
  });

  it('keeps launches oldest first, by block then log index', () => {
    const i = applyScan(base(), scan([launch({ token: A(3), block: 9 }), launch({ token: A(2), block: 5, logIndex: 4 }), launch({ token: A(1), block: 5, logIndex: 1 })]));
    expect(i.launches.map((l) => l.token)).toEqual([A(1), A(2), A(3)]);
  });

  it('lifecycle: on curve until graduated, by token (gen 1/2) or by curve (v6); unknown graduations ignored', () => {
    const g = launch({ token: A(10), gen: 2 });
    const v = launch({ token: A(20), gen: 6, name: 'V', symbol: 'V', curve: A(0xcafe) });
    let i = applyScan(base(), scan([g, v]));
    expect(i.launches.map(lifecycleOf)).toEqual(['curve', 'curve']);
    i = applyScan(i, scan([], [{ by: 'token', token: A(10), block: 700 }, { by: 'curve', curve: A(0xcafe), block: 800 }, { by: 'curve', curve: A(0xdead), block: 900 }, { by: 'token', token: A(99), block: 900 }]));
    expect(i.launches.map((l) => [lifecycleOf(l), l.graduatedBlock])).toEqual([
      ['graduated', 700],
      ['graduated', 800],
    ]);
    // the earliest graduation stays; a graduation in the same scan as its launch counts
    i = applyScan(i, scan([], [{ by: 'token', token: A(10), block: 750 }]));
    expect(i.launches[0]!.graduatedBlock).toBe(700);
    const same = applyScan(base(), scan([launch({ token: A(30), gen: 6, name: 'N', symbol: 'N', curve: A(0xbeef) })], [{ by: 'curve', curve: A(0xbeef), block: 101 }]));
    expect(lifecycleOf(same.launches[0]!)).toBe('graduated');
  });

  it('a graduation scanned after its launch in an earlier run still applies (v6 curve map spans runs)', () => {
    let i = applyScan(base(), scan([launch({ token: A(40), gen: 6, name: 'X', symbol: 'X', curve: A(0xfeed) })], [], 500));
    i = applyScan(i, scan([], [{ by: 'curve', curve: A(0xfeed), block: 600 }], 700));
    expect(i.launches[0]!.graduatedBlock).toBe(600);
    expect(i.toBlock).toBe(700);
  });

  it('names: from the event (v6) or the token, cleaned; never empty', () => {
    const i = applyScan(
      base(),
      scan([launch({ token: A(50) }), launch({ token: A(51) }), launch({ token: A(52), gen: 6, name: 'Inline', symbol: 'INL' })]),
      new Map([
        [A(50).toLowerCase(), { name: '  Moon\u0000 Dog‮ ', symbol: 'MOON' }],
        [A(51).toLowerCase(), { name: '', symbol: '' }],
      ]),
    );
    expect(i.launches.map((l) => [l.name, l.symbol])).toEqual([
      ['Moon Dog', 'MOON'],
      ['0x000000', '000000'],
      ['Inline', 'INL'],
    ]);
    expect(cleanText('x'.repeat(100))).toHaveLength(64);
  });

  it('knows which tokens still need a name read, and which quotes need a symbol', () => {
    const s = scan([launch({ token: A(60) }), launch({ token: A(61), gen: 6, name: 'a', symbol: 'b' })]);
    expect(tokensNeedingNames(s)).toEqual([A(60)]);
    const i = applyScan(base(), scan([
      launch({ token: A(70), gen: 6, name: 'a', symbol: 'A', quote: NVDA }),
      launch({ token: A(71), gen: 6, name: 'b', symbol: 'B', quote: A(70) }),
      launch({ token: A(72), gen: 6, name: 'c', symbol: 'C', quote: A(0xabc) }),
    ]));
    expect(tokensNeedingNames(s, applyScan(base(), s))).toEqual([]);
    expect(quotesNeedingSymbols(i)).toEqual([A(0xabc)]);
    expect(quotesNeedingSymbols(applyScan(i, scan([]), new Map(), { [A(0xabc)]: 'ODD' }))).toEqual([]);
  });

  it('quote assets: ETH, a test stock, USDG, another launch’s token, or a token read on-chain', () => {
    const usdg = tokenById('USDG')!.address;
    const i = applyScan(base(), scan([
      launch({ token: VIBEVIBE, gen: 6, name: 'VIBEVIBE', symbol: 'VIBEVIBE' }),
      launch({ token: A(81), gen: 6, name: 'n', symbol: 'N', quote: NVDA }),
      launch({ token: A(82), gen: 6, name: 'u', symbol: 'U', quote: usdg }),
      launch({ token: A(83), gen: 6, name: 'q', symbol: 'Q', quote: VIBEVIBE }),
      launch({ token: A(84), gen: 6, name: 'o', symbol: 'O', quote: A(0x0dd) }),
    ]), new Map(), { [A(0x0dd)]: 'ODD' });
    expect(i.launches.map((l) => quoteOf(l, i))).toEqual([
      { kind: 'eth', symbol: 'ETH', address: null },
      { kind: 'stock', symbol: 'NVDA', address: NVDA },
      { kind: 'token', symbol: 'USDG', address: usdg },
      { kind: 'launch', symbol: 'VIBEVIBE', address: VIBEVIBE },
      { kind: 'token', symbol: 'ODD', address: A(0x0dd) },
    ]);
  });

  it('round-trips through its compact wire form, and rejects anything else', () => {
    const i = applyScan(base(), scan([launch({ token: A(90), gen: 6, name: 'a', symbol: 'A', quote: NVDA })], [{ by: 'curve', curve: launch({ token: A(90) }).curve, block: 300 }]), new Map(), { [A(1)]: 'Q' }, 1234);
    const back = decodeIndex(JSON.parse(JSON.stringify(encodeIndex(i))));
    expect(back).toEqual(i);
    expect(decodeIndex(null)).toBeNull();
    expect(decodeIndex({ version: LAUNCH_INDEX_VERSION + 1, toBlock: 1, rows: [] })).toBeNull();
    expect(decodeIndex({ ...encodeIndex(i), rows: [['nope']] })).toBeNull();
  });
});

describe('reviewable assets and search', () => {
  const index = applyScan(base(), scan([
    launch({ token: getAddress('0x2aae5f5627e75938973e8a3fa666ce79e0f58b18'), gen: 6, name: 'Moon Dog', symbol: 'MOON', block: 10 }),
    launch({ token: A(0xa2), gen: 6, name: 'Moonshot Cat', symbol: 'MSC', block: 20 }),
    launch({ token: A(0xa3), gen: 6, name: 'Harvest Moon', symbol: 'HMOON', block: 30 }),
    launch({ token: A(0xa4), gen: 6, name: 'Apple Pie', symbol: 'PIE', block: 40 }),
  ]));
  const assets = allAssets(index);

  it('includes the five test stocks first, then launches newest first', () => {
    expect(reviewableStocks().map((s) => s.symbol)).toEqual(['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI']);
    expect(assets.map((a) => a.symbol)).toEqual(['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI', 'PIE', 'HMOON', 'MSC', 'MOON']);
    expect(assets.find((a) => a.symbol === 'MOON')).toMatchObject({ kind: 'launch', status: 'curve', quote: { kind: 'eth', symbol: 'ETH' } });
    expect(allAssets(null)).toHaveLength(5);
  });

  it('finds by symbol (with or without $), name, word, address or address prefix, best match first', () => {
    const syms = (q: string) => searchAssets(assets, q).map((a) => a.symbol);
    expect(syms('moon')).toEqual(['MOON', 'MSC', 'HMOON']); // exact symbol, name prefix, a word of the name
    expect(syms('$MOON')).toEqual(['MOON', 'MSC', 'HMOON']);
    expect(syms('apple')).toEqual(['AAPL', 'PIE']); // the stock's name is "Apple…"
    expect(syms('nvda')).toEqual(['NVDA']);
    expect(syms('0x2AAE5F5627E75938973E8A3FA666CE79E0F58B18')).toEqual(['MOON']);
    expect(syms('0x2aae5f')).toEqual(['MOON']);
    expect(syms(tokenById('OPENAI')!.address.toLowerCase())).toEqual(['OPENAI']);
    expect(syms('   ')).toEqual([]);
    expect(syms('zzz')).toEqual([]);
    expect(searchAssets(assets, 'o', 2)).toHaveLength(2);
  });
});

describe('reading the chain (fake RPC)', () => {
  it('halves a getLogs range the node finds too big, and keeps going', async () => {
    const calls: Array<[number, number]> = [];
    const client = {
      request: async ({ params }: { params: [{ fromBlock: string; toBlock: string }] }) => {
        const a = Number(params[0].fromBlock);
        const b = Number(params[0].toBlock);
        calls.push([a, b]);
        if (b - a > 30_000) throw Object.assign(new Error('RPC error'), { cause: new Error('response size exceeded the limit') });
        return [];
      },
    } as unknown as PublicClient;
    await getLogsSplit(client, { topics: [] }, 0n, 99_999n);
    expect(calls.filter(([a, b]) => b - a <= 30_000).reduce((s, [a, b]) => s + (b - a + 1), 0)).toBe(100_000);
    const bad = { request: async () => Promise.reject(new Error('execution reverted')) } as unknown as PublicClient;
    await expect(getLogsSplit(bad, { topics: [] }, 0n, 10n)).rejects.toThrow('execution reverted');
  });

  it('scans launches and graduations from raw RPC logs', async () => {
    const raw = (k: string) => ({ ...V[k]! });
    const client = {
      request: async ({ params }: { params: [{ address?: string | string[]; topics: unknown[]; fromBlock: string; toBlock: string }] }) => {
        const { address, topics, fromBlock, toBlock } = params[0];
        const all =
          Array.isArray(address) && address.length === 4
            ? [raw('gen1'), raw('v6eth')]
            : Array.isArray(address)
              ? [raw('gradLegacy')]
              : topics[0] === V.v6curveGrad!.topics[0]
                ? [raw('v6curveGrad'), { ...raw('v6curveGrad'), address: A(5) }]
                : [];
        return all.filter((l) => Number(l.blockNumber) >= Number(fromBlock) && Number(l.blockNumber) <= Number(toBlock));
      },
    } as unknown as PublicClient;
    const s = await scanLaunches(client, 108_000_000n, 133_000_000n);
    expect(s.launches.map((l) => l.gen)).toEqual([6, 1]); // in block order: VIBEVIBE (126.07M) before the gen 1 sample (132.81M)
    expect(s.graduations.map((g) => g.by)).toEqual(['token', 'curve', 'curve']);
    const i = applyScan(base(), s);
    expect(i.launches.find((l) => l.token === VIBEVIBE)!.graduatedBlock).toBe(126079452); // the stray curve is ignored
  });

  it('reads many live balances in one multicall (null where a read failed)', async () => {
    const client = {
      multicall: async ({ contracts }: { contracts: Array<{ address: string }> }) =>
        contracts.map((c, i) => (i === 1 ? { status: 'failure', error: new Error('x') } : { status: 'success', result: BigInt(i + 1) })),
    } as unknown as PublicClient;
    const m = await balancesOf(client, A(1), [A(7), A(8), A(9)]);
    expect([...m.values()]).toEqual([1n, null, 3n]);
  });
});
