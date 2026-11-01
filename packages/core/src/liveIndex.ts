/**
 * The launch index as the site holds it: the published index, brought up to the chain head, with
 * the lists and lookups every route uses (assets, by token, by curve).
 *
 * Building those from 257,000 launches takes seconds, and the head moves every 0.12 s, so doing it
 * again for each refresh (what applyScan + allAssets do from scratch) cost the server more than
 * everything else it does. This keeps them and changes only what a scan changes: a new launch is
 * inserted where it belongs, a graduation replaces one entry. A refresh with nothing new costs
 * nothing. The result is always what applyScan + allAssets would have produced (liveIndex.test.ts
 * holds that, against randomised scans).
 *
 * The arrays and maps are owned here and updated in place: callers read them, never write.
 */
import type { Address } from 'viem';
import { allAssets, launchAsset, reviewableStocks, type ReviewableAsset } from './assets';
import { applyScan, cleanText, quotesNeedingSymbolsFor, type Launch, type LaunchIndex, type ScanResult } from './launches';

const key = (a: string) => a.toLowerCase();
const before = (a: Pick<Launch, 'block' | 'logIndex'>, b: Pick<Launch, 'block' | 'logIndex'>) => (a.block !== b.block ? a.block < b.block : a.logIndex < b.logIndex);

export class LiveLaunchIndex {
  /** the index: `launches` is this object's own array (oldest first), updated in place */
  index: LaunchIndex;
  /** the stocks first, then launches newest first (what allAssets returns) */
  assets: ReviewableAsset[];
  assetByToken: Map<string, ReviewableAsset>;
  launchByToken: Map<string, Launch>;
  private launchByCurve: Map<string, Launch>;
  private stocks: number;

  /** One pass over the index: the only expensive step, done once per published index. */
  constructor(from: LaunchIndex) {
    this.index = { ...from, launches: [...from.launches], quoteSymbols: { ...from.quoteSymbols } };
    this.launchByToken = new Map();
    this.launchByCurve = new Map();
    for (const l of this.index.launches) {
      this.launchByToken.set(key(l.token), l);
      this.launchByCurve.set(key(l.curve), l);
    }
    const stocks = reviewableStocks();
    this.stocks = stocks.length;
    const launches = this.index.launches;
    const assets: ReviewableAsset[] = new Array(stocks.length + launches.length);
    stocks.forEach((s, i) => (assets[i] = s));
    for (let i = launches.length - 1, at = stocks.length; i >= 0; i--, at++) assets[at] = launchAsset(launches[i]!, this.index, this.launchByToken);
    this.assets = assets;
    this.assetByToken = new Map(assets.map((a) => [key(a.token), a]));
  }

  /** The tokens in `scan` whose name and symbol still have to be read from the token itself. */
  tokensNeedingNames(scan: ScanResult): Address[] {
    return [...new Set(scan.launches.filter((l) => l.name === null || l.symbol === null).map((l) => l.token))].filter((t) => !this.launchByToken.has(key(t)));
  }

  /** Quote assets of `launches` (just added) whose symbol isn't known yet. */
  quotesNeedingSymbols(launches: readonly Launch[]): Address[] {
    return quotesNeedingSymbolsFor(launches, this.index, (k) => this.launchByToken.has(k));
  }

  /**
   * Record the symbols of quote assets read since `added` were added, and rebuild those launches'
   * assets (they were built while the symbol was still unknown).
   */
  setQuoteSymbols(symbols: Record<string, string>, added: readonly Launch[] = []): void {
    for (const [a, s] of Object.entries(symbols)) this.index.quoteSymbols[key(a)] = cleanText(s);
    for (const l of added) {
      const k = this.launchByToken.get(key(l.token));
      if (!k || !k.quote || !symbols[key(k.quote)]) continue;
      const p = this.position(k);
      const asset = launchAsset(k, this.index, this.launchByToken);
      this.assets[this.stocks + (this.index.launches.length - 1 - p)] = asset;
      this.assetByToken.set(key(k.token), asset);
    }
  }

  /** Fold a scan in, as applyScan would; returns the launches it added. */
  apply(scan: ScanResult, names: ReadonlyMap<string, { name: string; symbol: string }> = new Map(), now = Math.floor(Date.now() / 1000)): Launch[] {
    const added: Launch[] = [];
    for (const d of scan.launches) {
      const old = this.launchByToken.get(key(d.token));
      if (old && !before(d, old)) continue; // the earliest launch event wins; a repeat is a re-scan
      if (old) return this.rebuild(scan, names, now); // an earlier event than the one held: rare, do it the long way
      const read = names.get(key(d.token));
      const name = d.name ?? (read ? cleanText(read.name) : null) ?? '';
      const symbol = d.symbol ?? (read ? cleanText(read.symbol) : null) ?? '';
      const launch: Launch = {
        ...d,
        name: name || symbol || d.token.slice(0, 8),
        symbol: symbol || name || d.token.slice(2, 8).toUpperCase(),
        graduatedBlock: null,
      };
      this.insert(launch);
      added.push(launch);
    }
    for (const g of scan.graduations) {
      const l = g.by === 'token' ? this.launchByToken.get(key(g.token)) : this.launchByCurve.get(key(g.curve));
      if (!l) continue; // a graduation for something the index doesn't know is ignored
      if (l.graduatedBlock === null || g.block < l.graduatedBlock) this.replace(l, { ...l, graduatedBlock: g.block });
    }
    this.index.toBlock = Math.max(this.index.toBlock, scan.toBlock);
    this.index.generatedAt = now;
    return added;
  }

  /** Every block up to this one has been scanned (the last ones had nothing in them). */
  advanceTo(block: number): void {
    if (block > this.index.toBlock) this.index.toBlock = block;
  }

  /** Where `l` sits in `launches` (oldest first): binary search, then confirm. */
  private position(l: Pick<Launch, 'block' | 'logIndex' | 'token'>): number {
    const a = this.index.launches;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (before(a[mid]!, l)) lo = mid + 1;
      else hi = mid;
    }
    if (a[lo] && key(a[lo]!.token) === key(l.token)) return lo;
    return a.findIndex((x) => key(x.token) === key(l.token)); // same block and log index as another: never in practice
  }

  private insert(launch: Launch): void {
    const a = this.index.launches;
    const n = a.length;
    let p = n;
    if (n > 0 && !before(a[n - 1]!, launch)) {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (before(a[mid]!, launch)) lo = mid + 1;
        else hi = mid;
      }
      p = lo;
    }
    a.splice(p, 0, launch);
    this.launchByToken.set(key(launch.token), launch);
    this.launchByCurve.set(key(launch.curve), launch);
    const asset = launchAsset(launch, this.index, this.launchByToken);
    // `assets` runs the other way (newest first) after the stocks
    this.assets.splice(this.stocks + (n - p), 0, asset);
    this.assetByToken.set(key(launch.token), asset);
  }

  private replace(old: Launch, next: Launch): void {
    const p = this.position(old);
    const n = this.index.launches.length;
    this.index.launches[p] = next;
    this.launchByToken.set(key(next.token), next);
    this.launchByCurve.set(key(next.curve), next);
    const asset = launchAsset(next, this.index, this.launchByToken);
    this.assets[this.stocks + (n - 1 - p)] = asset;
    this.assetByToken.set(key(next.token), asset);
  }

  /** The long way (applyScan + allAssets), for the rare scan that can't be folded in place. */
  private rebuild(scan: ScanResult, names: ReadonlyMap<string, { name: string; symbol: string }>, now: number): Launch[] {
    const known = new Set(this.launchByToken.keys());
    const fresh = new LiveLaunchIndex(applyScan(this.index, scan, names, {}, now));
    this.index = fresh.index;
    this.assets = fresh.assets;
    this.assetByToken = fresh.assetByToken;
    this.launchByToken = fresh.launchByToken;
    this.launchByCurve = fresh.launchByCurve;
    this.stocks = fresh.stocks;
    return this.index.launches.filter((l) => !known.has(key(l.token)));
  }

  /** What allAssets returns for this index: for tests, and for checking nothing has drifted. */
  fromScratch(): ReviewableAsset[] {
    return allAssets(this.index);
  }
}
