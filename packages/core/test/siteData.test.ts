import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { LiveLaunchIndex, findRowIn, fromLaunchRow, launchRow, launchShardKey, searchAssets, searchKeyForQuery, searchKeysFor, type Launch } from '../src';

/*
 * The site's data is stored as static files and read back in the browser: a launch must come back
 * exactly as the server's own index builds it, and a search must look in the file its words were put in.
 */
const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
const launches: Launch[] = [
  { token: A(0xab01), name: 'Moon Cat', symbol: 'MCAT', quote: null, creator: A(1), curve: A(0x51), gen: 6, launchId: 1, block: 100, logIndex: 1, graduatedBlock: null },
  { token: A(0xcd02), name: 'Dog', symbol: 'DOG', quote: '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2' as Address, creator: A(2), curve: A(0x52), gen: 6, launchId: 2, block: 110, logIndex: 1, graduatedBlock: 150 },
  { token: A(0xef03), name: 'Pairs with Dog', symbol: 'PWD', quote: A(0xcd02), creator: A(3), curve: A(0x53), gen: 6, launchId: 3, block: 120, logIndex: 1, graduatedBlock: null },
  { token: A(0x1204), name: 'Odd quote', symbol: 'ODD', quote: A(0x9999), creator: A(4), curve: A(0x54), gen: 6, launchId: 4, block: 130, logIndex: 1, graduatedBlock: null },
];
const live = new LiveLaunchIndex({ version: 2, chainId: 46630, toBlock: 200, generatedAt: 1, launches, quoteSymbols: { [A(0x9999)]: 'QQQ' } });

describe('launch rows', () => {
  it('come back as the index’s own launch and asset, for every kind of quote', () => {
    for (const l of live.index.launches) {
      const asset = live.assetByToken.get(l.token.toLowerCase())!;
      const back = fromLaunchRow(JSON.parse(JSON.stringify(launchRow(l, asset))));
      expect(back.launch).toEqual(l);
      expect(back.asset).toEqual(asset);
    }
  });

  it('are filed by the first two hex digits of the token, whatever its case', () => {
    expect(launchShardKey(A(0xab01))).toBe('00');
    expect(launchShardKey('0xAB12345678901234567890123456789012345678')).toBe('ab');
  });

  it('are found in a shard’s text without parsing the rest, and not found when absent', () => {
    const rows = live.index.launches.map((l) => launchRow(l, live.assetByToken.get(l.token.toLowerCase())!));
    const text = JSON.stringify(rows);
    for (const l of live.index.launches) expect(findRowIn(text, l.token)?.[0]).toBe(l.token);
    expect(findRowIn(text, A(0x7777))).toBeNull();
    expect(findRowIn(text, A(0xab01).toUpperCase().replace('0X', '0x'))?.[2]).toBe('MCAT'); // a differently cased address
  });
});

describe('search files', () => {
  it('put a launch under its symbol and each word of its name', () => {
    expect(searchKeysFor('MCAT', 'Moon Cat').sort()).toEqual(['ca', 'mc', 'mo']);
    expect(searchKeysFor('A', 'A')).toEqual(['a_']);
    expect(searchKeysFor('DOGE_2', 'Dog-Wif Hat')).toEqual(expect.arrayContaining(['do', '2_', 'wi', 'ha']));
  });

  it('look in the file of the first word typed, with or without a $', () => {
    expect(searchKeyForQuery('moon cat')).toBe('mo');
    expect(searchKeyForQuery('$MCAT')).toBe('mc');
    expect(searchKeyForQuery(' $a ')).toBe('a_');
    expect(searchKeyForQuery('   ')).toBeNull();
    expect(searchKeyForQuery('$')).toBeNull();
  });

  it('find everything the full search finds that starts a word, in the one file read', () => {
    const everything = live.assets.filter((a) => a.kind === 'launch');
    for (const q of ['moon', 'cat', 'mcat', '$dog', 'dog', 'pairs', 'odd']) {
      const key = searchKeyForQuery(q)!;
      const file = everything.filter((a) => searchKeysFor(a.symbol, a.name).includes(key));
      // what the server returns that starts a word or the symbol (it also returns "contains" matches the files don't hold)
      const full = searchAssets(everything, q);
      const fromFile = searchAssets(file, q);
      const startsAWord = (a: { symbol: string; name: string }) => [a.symbol, ...a.name.split(/[^A-Za-z0-9]+/)].some((w) => w.toLowerCase().startsWith(q.replace(/^\$/, '').toLowerCase().split(/\s+/)[0]!));
      expect(fromFile.map((a) => a.token), q).toEqual(full.filter(startsAWord).map((a) => a.token));
    }
  });
});
