/**
 * The site's data as static files: how a launch is stored in a shard, and which search shard a
 * word belongs to. Shared by the job that writes the files (apps/web/scripts/build-site-data.ts) and
 * the browser that reads them, so the two can't disagree.
 *
 * Why files: the site is hosted where a request gets 10 ms of CPU and 128 MB, and the launch index
 * is 257,000 launches. So nothing loads the index at request time. It is split by the first two
 * hex digits of the token address into 256 files (about 1,000 launches, 96 KB compressed, each), a
 * token page reads the one it needs, and search reads the one for the first two letters typed.
 */
import type { Address } from 'viem';
import type { ReviewableAsset } from './assets';
import type { Launch, LaunchGen, QuoteKind } from './launches';

/**
 * One launch with what is derived from the rest of the index already worked out:
 * [token, name, symbol, quote address ('' = ETH), quote kind, quote symbol, creator, curve, gen,
 *  launch id, block, log index, graduation block (0 = still on its curve)]
 */
export type LaunchShardRow = [string, string, string, string, string, string, string, string, number, number, number, number, number];

/** Which of the 256 launch files holds this token. */
export const launchShardKey = (token: string): string => token.slice(2, 4).toLowerCase();

export function launchRow(l: Launch, asset: Pick<ReviewableAsset, 'quote'>): LaunchShardRow {
  const q = asset.quote ?? { kind: 'eth' as QuoteKind, symbol: 'ETH', address: null };
  return [l.token, l.name, l.symbol, l.quote ?? '', q.kind, q.symbol, l.creator, l.curve, l.gen, l.launchId, l.block, l.logIndex, l.graduatedBlock ?? 0];
}

/** The launch and its asset, as the server's own index builds them. */
export function fromLaunchRow(r: LaunchShardRow): { launch: Launch; asset: ReviewableAsset } {
  const [token, name, symbol, quote, quoteKind, quoteSymbol, creator, curve, gen, launchId, block, logIndex, graduated] = r;
  const launch: Launch = {
    token: token as Address,
    name,
    symbol,
    quote: quote ? (quote as Address) : null,
    creator: creator as Address,
    curve: curve as Address,
    gen: gen as LaunchGen,
    launchId,
    block,
    logIndex,
    graduatedBlock: graduated > 0 ? graduated : null,
  };
  const asset: ReviewableAsset = {
    kind: 'launch',
    token: launch.token,
    name,
    fullName: null,
    symbol,
    status: launch.graduatedBlock === null ? 'curve' : 'graduated',
    quote: { kind: quoteKind as QuoteKind, symbol: quoteSymbol, address: quote ? (quote as Address) : null },
    creator: launch.creator,
    block,
    gen: launch.gen,
  };
  return { launch, asset };
}

/** The row for `token` in the text of its shard, without parsing the other thousand. */
export function findRowIn(shardText: string, token: string): LaunchShardRow | null {
  const needle = `["${token}",`;
  let at = shardText.indexOf(needle);
  if (at < 0) at = shardText.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return null;
  // a row has no nested brackets: it ends at the first ']'
  const end = shardText.indexOf(']', at);
  try {
    return JSON.parse(shardText.slice(at, end + 1)) as LaunchShardRow;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ search

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** The words a launch is searched by: its symbol and each word of its name, lower-case. */
export const searchWordsOf = (symbol: string, name: string): string[] => [...new Set([...words(symbol), ...words(name)])];

/**
 * A two-letter file with too many launches ("vi": there are 14,000 named "Vibe …") is written as
 * { split: true, top: [the newest few] } and its launches go in three-letter files instead.
 */
export interface SplitSearchFile {
  split: true;
  top: LaunchShardRow[];
}
export const isSplitSearchFile = (f: unknown): f is SplitSearchFile => !!f && typeof f === 'object' && !Array.isArray(f) && (f as { split?: unknown }).split === true;
export const SEARCH_SPLIT_OVER = 2_500;
export const searchKey3Of = (word: string): string => word.slice(0, 3);
/** The two-character key of a word ("moon" → "mo"; "a" → "a_"). */
export const searchKeyOf = (word: string): string => (word.length >= 2 ? word.slice(0, 2) : `${word}_`);

/** Every search file a launch belongs in: one for its symbol and one for each word of its name. */
export function searchKeysFor(symbol: string, name: string): string[] {
  return [...new Set([...words(symbol), ...words(name)].map(searchKeyOf))];
}

/** The first word of what was typed, as it is searched for ($ and case ignored), or null. */
export const firstSearchWord = (query: string): string | null => words(query.replace(/^\s*\$/, ''))[0] ?? null;

/** The search file to read for what was typed, or null when there is nothing to look up. */
export function searchKeyForQuery(query: string): string | null {
  const w = firstSearchWord(query);
  return w ? searchKeyOf(w) : null;
}
