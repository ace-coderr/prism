/**
 * Everything that can be reviewed: the five test stocks and every vibe/vibe launch, in one shape,
 * with search by name, symbol or address.
 */
import { isAddress, type Address } from 'viem';
import { lifecycleOf, quoteOf, type Launch, type LaunchGen, type LaunchIndex, type Lifecycle, type QuoteKind } from './launches';
import { TESTNET_TOKENS } from './tokens';

/** The test stocks people can review (vibe/vibe Discover stocks + pre-IPO test assets). */
export const REVIEWABLE_STOCK_IDS = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI'] as const;

export interface ReviewableAsset {
  kind: 'stock' | 'launch';
  token: Address;
  name: string;
  symbol: string;
  /** launches only */
  status: Lifecycle | null;
  quote: { kind: QuoteKind; symbol: string; address: Address | null } | null;
  creator: Address | null;
  /** launch block */
  block: number | null;
  gen: LaunchGen | null;
}

export const reviewableStocks = (): ReviewableAsset[] =>
  REVIEWABLE_STOCK_IDS.map((id) => {
    const t = TESTNET_TOKENS.find((x) => x.id === id)!;
    return { kind: 'stock', token: t.address, name: t.name, symbol: t.id, status: null, quote: null, creator: null, block: null, gen: null };
  });

export function launchAsset(l: Launch, index: Pick<LaunchIndex, 'launches' | 'quoteSymbols'>, byToken?: ReadonlyMap<string, Launch>): ReviewableAsset {
  return {
    kind: 'launch',
    token: l.token,
    name: l.name,
    symbol: l.symbol,
    status: lifecycleOf(l),
    quote: quoteOf(l, index, byToken),
    creator: l.creator,
    block: l.block,
    gen: l.gen,
  };
}

/** Every reviewable asset: the stocks first, then launches newest first. */
export function allAssets(index: LaunchIndex | null): ReviewableAsset[] {
  if (!index) return reviewableStocks();
  const byToken = new Map(index.launches.map((l) => [l.token.toLowerCase(), l]));
  const launches: ReviewableAsset[] = [];
  for (let i = index.launches.length - 1; i >= 0; i--) launches.push(launchAsset(index.launches[i]!, index, byToken));
  return [...reviewableStocks(), ...launches];
}

/** How well an asset matches; 0 = not at all. */
function score(a: ReviewableAsset, q: string): number {
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

/**
 * Search by name, symbol ($ optional) or address (full, or a 0x… prefix). Best match first:
 * exact symbol, exact name, symbol prefix, name prefix, a word of the name, then anywhere;
 * among equals, stocks, then graduated launches, then the newest.
 */
export function searchAssets(assets: readonly ReviewableAsset[], query: string, limit = 20): ReviewableAsset[] {
  const q = query.trim();
  if (!q) return [];
  const hits: Array<{ a: ReviewableAsset; s: number }> = [];
  for (const a of assets) {
    const s = score(a, q);
    if (s > 0) hits.push({ a, s });
  }
  hits.sort((x, y) => y.s - x.s || rank(y.a) - rank(x.a) || (y.a.block ?? 0) - (x.a.block ?? 0));
  return hits.slice(0, limit).map((h) => h.a);
}
