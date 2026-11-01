import { describe, expect, it } from 'vitest';
import { isAddress, type Address } from 'viem';
import { searchAssets, type ReviewableAsset } from '../src';

/*
 * searchAssets caches each asset's lower-case fields and works the query out once. Its answers must
 * be exactly what the plain per-asset version gave (kept here as the reference).
 */
function reference(a: ReviewableAsset, q: string): number {
  if (isAddress(q, { strict: false })) return a.token.toLowerCase() === q.toLowerCase() ? 100 : 0;
  if (/^0x[0-9a-f]{2,39}$/i.test(q)) return a.token.toLowerCase().startsWith(q.toLowerCase()) ? 50 : 0;
  const t = q.toLowerCase().replace(/^\$/, '');
  if (!t) return 0;
  const sym = a.symbol.toLowerCase();
  const name = a.name.toLowerCase();
  if (sym === t) return 90;
  if (name === t) return 80;
  if (sym.startsWith(t)) return 70;
  if (name.startsWith(t)) return 60;
  if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(t))) return 50;
  if (sym.includes(t)) return 40;
  if (name.includes(t)) return 30;
  return 0;
}
const rank = (a: ReviewableAsset) => (a.kind === 'stock' ? 2 : a.status === 'graduated' ? 1 : 0);
const referenceSearch = (assets: ReviewableAsset[], query: string, limit: number) => {
  const q = query.trim();
  if (!q) return [];
  const hits = assets.flatMap((a) => (reference(a, q) > 0 ? [{ a, s: reference(a, q) }] : []));
  hits.sort((x, y) => y.s - x.s || rank(y.a) - rank(x.a) || (y.a.block ?? 0) - (x.a.block ?? 0));
  return hits.slice(0, limit).map((h) => h.a);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const WORDS = ['moon', 'Dog', 'cat', 'PEPE', 'baby', 'Bored Ape', 'wif hat', 'x-coin', 'doge_2', 'ÉTÉ', 'ice', 'AAA', 'prism'];

describe('search', () => {
  it('answers exactly as the plain version did, for names, symbols, $-prefixes and addresses', () => {
    const r = rng(5);
    const pick = () => WORDS[Math.floor(r() * WORDS.length)]!;
    const assets: ReviewableAsset[] = Array.from({ length: 2000 }, (_, i) => ({
      kind: i < 5 ? 'stock' : 'launch',
      token: `0x${(i * 7919 + 12345).toString(16).padStart(40, '0')}` as Address,
      name: `${pick()} ${pick()}${r() < 0.3 ? ` ${i}` : ''}`,
      fullName: null,
      symbol: `${pick().replace(/\W/g, '')}${r() < 0.5 ? i % 9 : ''}`,
      status: r() < 0.3 ? 'graduated' : 'curve',
      quote: null,
      creator: null,
      block: 1000 + i,
      gen: 6,
    }));
    const queries = ['moon', 'MOON', '$moon', 'm', 'do', 'cat', 'ape', 'wif', 'hat', 'x-', 'doge', '2', 'été', 'ice', 'zzz', ' prism ', '$', '', '   ', assets[40]!.token, assets[40]!.token.toUpperCase().replace('0X', '0x'), assets[7]!.token.slice(0, 12), '0xab'];
    for (const q of queries) for (const limit of [3, 20]) expect(searchAssets(assets, q, limit), `"${q}" limit ${limit}`).toEqual(referenceSearch(assets, q, limit));
    // a second run uses what was cached from the first: same answers
    for (const q of queries) expect(searchAssets(assets, q, 20)).toEqual(referenceSearch(assets, q, 20));
  });
});
