/**
 * vibe/vibe launches, read from the chain only (their launch contracts' events, never their API).
 *
 * Four factory generations launch tokens on Robinhood Chain Testnet, each a bonding curve that
 * later "graduates" into a Uniswap V4 pool:
 *
 * - gen 0: factory 0x4FEb…91dF (the first, still in use), gen 1: factory 0xB5B7…9eb9 (2026-08-27)
 *   and gen 2: factory 0x40f1…DF59 (2026-09-07). They emit
 *   `TokenLaunched(launchId, token, curve, creator, …, metadataURI)` and their launches are paired
 *   with ETH (gen 2 emitted one stock-paired launch, with its quote asset in the data). Their
 *   graduation adapters emit `PoolGraduated(token, curve, poolId, …)`. Name and symbol aren't in
 *   the event: they are read from the token (name(), symbol()).
 * - v6: factory 0xe794…Fea0, the one stock-paired launches use. Its launch event
 *   carries the curve, name, symbol, metadata URI, quote asset (zero = ETH, else an ERC-20: a test
 *   stock, USDG, VIBEVIBE or another launch's token) and creator. Each curve emits its own
 *   graduation event.
 *
 * The factories are unverified on the explorer. The gen 0/1/2 events above are exact (their topic
 * hashes match these signatures, and the explorer decodes them so); the v6 layout is vibe/vibe's own
 * published ABI (LaunchCreated, from their web app); the stock-paired gen 2 layout was worked out
 * from a real log. packages/core/test/launches.test.ts decodes real events of every kind.
 *
 * Everything here is pure; ./launchScan.ts does the RPC reads.
 */
import { getAddress, hexToBigInt, hexToString, type Address, type Hex } from 'viem';
import { TESTNET_TOKENS, type TestnetToken } from './tokens';

export type LaunchGen = 0 | 1 | 2 | 6;

export interface VibeFactory {
  gen: LaunchGen;
  factory: Address;
  /** first block worth scanning (the factory's deployment) */
  fromBlock: bigint;
  /** gen 0/1/2: the graduation adapter that emits PoolGraduated; v6 curves emit their own */
  adapter: Address | null;
}

/**
 * Addresses from vibe/vibe's published chain config (gen 1, 2, v6) and their web app's listing config
 * (gen 0), each checked on-chain: code, launch events and graduation events.
 */
export const VIBE_FACTORIES: readonly VibeFactory[] = [
  { gen: 0, factory: '0x4FEbC267e0C24440bcDEF72B5DBC5FE7BED091dF', fromBlock: 95_916_239n, adapter: '0x1fD0f2BD38ADa69e2eF138FAf5377c5a5A574e8f' },
  { gen: 1, factory: '0xB5B7A2f6c4EAFa2D73918fcA32d50e2126339eb9', fromBlock: 108_435_450n, adapter: '0x1eD9E88AE14713ca4bc964BADe2Bc1e3f5CD501a' },
  { gen: 2, factory: '0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59', fromBlock: 115_025_604n, adapter: '0xA6a5D4C098dA8f79eae1203A8E42ff9AC7a17F06' },
  { gen: 6, factory: '0xe794217880011f9cA6961340eD5c16EC9559Fea0', fromBlock: 123_503_237n, adapter: null },
];

/** The first block any vibe/vibe launch can be in. */
export const FIRST_LAUNCH_BLOCK = VIBE_FACTORIES.reduce((m, f) => (f.fromBlock < m ? f.fromBlock : m), VIBE_FACTORIES[0]!.fromBlock);
/** v6 curves exist from here on. */
export const V6_FROM_BLOCK = VIBE_FACTORIES.find((f) => f.gen === 6)!.fromBlock;

export const TOPICS = {
  /** gen 0/1/2: TokenLaunched(uint256 indexed launchId, address indexed token, address indexed curve, address creator, address creatorFeeRecipient, address creatorVault, uint256 initialBuy, uint256 initialTokensBought, uint16 metadataSchemaVersion, bytes32 metadataDigest, string metadataURI) */
  tokenLaunched: '0x56eef5c350583250e71791d6d659f4d181796c9deb08b977252efc3995aa9279',
  /** gen 2, paired with a quote asset: same topics; data (creator, feeRecipient, vault, quote, …, metadataURI) */
  tokenLaunchedWithQuote: '0x34041bc557672fe6a73853ece671e7715108f75e25427bfddf3e2f8e2085a0e7',
  /** v6: LaunchCreated(uint256 indexed launchId, address indexed launcher, address indexed token, address curve, string name, string symbol, string metadataURI, address pairCurrency, uint16 taxBps, uint64 packedWeights, address projectTreasury, uint256 targetPairUnits, uint256 netPersonal, uint256 giftNetTotal, bytes32 giftRoot, uint256 giftCount) */
  v6Launched: '0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8',
  /** gen 0/1/2 adapters: PoolGraduated(address indexed token, address indexed curve, bytes32 indexed poolId, …) */
  poolGraduated: '0xb085a27251b4f22bc3b1efdffb548e1857dd368d1998cdd133291040c2276f1c',
  /** v6 curves: graduated into a pool (topic1 = poolId), emitted by the curve itself */
  curveGraduated: '0xab164bba6f9a29b6722f18be5ea821368fedba444c4f8733118f3557d77ab2ae',
} as const satisfies Record<string, Hex>;

export const LAUNCH_TOPICS = [TOPICS.tokenLaunched, TOPICS.tokenLaunchedWithQuote, TOPICS.v6Launched] as const;

/** A launch as its event tells it (gen 0/1/2 events carry no name or symbol: null until read). */
export interface DecodedLaunch {
  token: Address;
  name: string | null;
  symbol: string | null;
  /** null = ETH */
  quote: Address | null;
  creator: Address;
  curve: Address;
  gen: LaunchGen;
  launchId: number;
  block: number;
  logIndex: number;
}

export interface Launch extends Omit<DecodedLaunch, 'name' | 'symbol'> {
  name: string;
  symbol: string;
  /** block of its graduation into a pool, or null while it's still on its curve */
  graduatedBlock: number | null;
}

export type Lifecycle = 'curve' | 'graduated';
export const lifecycleOf = (l: Pick<Launch, 'graduatedBlock'>): Lifecycle => (l.graduatedBlock === null ? 'curve' : 'graduated');

/** A graduation: by token (gen 0/1/2 adapters) or by the curve that emitted it (v6). */
export type Graduation = { by: 'token'; token: Address; block: number } | { by: 'curve'; curve: Address; block: number };

/** The log fields the decoders need (viem's Log has them all). */
export interface RawLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  blockNumber: bigint | null;
  logIndex: number | null;
}

const ZERO = '0x0000000000000000000000000000000000000000';
const word = (data: Hex, i: number) => `0x${data.slice(2 + i * 64, 2 + (i + 1) * 64)}` as Hex;
const addressAt = (w: Hex) => getAddress(`0x${w.slice(-40)}`);
const topicAddress = (t: Hex | undefined) => (t ? addressAt(t) : null);
/** An ABI-encoded string whose offset is in head word `i`. */
function stringAt(data: Hex, i: number): string {
  const offset = Number(hexToBigInt(word(data, i)));
  const start = 2 + offset * 2;
  const len = Number(BigInt(`0x${data.slice(start, start + 64)}`));
  return hexToString(`0x${data.slice(start + 64, start + 64 + len * 2)}`);
}
const nonZero = (a: Address) => (a.toLowerCase() === ZERO ? null : a);

const genOf = (address: Address): LaunchGen | null =>
  VIBE_FACTORIES.find((f) => f.factory.toLowerCase() === address.toLowerCase())?.gen ?? null;

/** A launch event from one of the factories, or null for any other log. */
export function decodeLaunchLog(log: RawLog): DecodedLaunch | null {
  const gen = genOf(log.address);
  const [topic0, t1, t2, t3] = log.topics;
  if (gen === null || !t1 || !t2 || !t3 || log.blockNumber === null || log.logIndex === null) return null;
  const at = { block: Number(log.blockNumber), logIndex: log.logIndex, launchId: Number(hexToBigInt(t1)), gen };
  try {
    if (topic0 === TOPICS.tokenLaunched && gen !== 6) {
      return { ...at, token: topicAddress(t2)!, curve: topicAddress(t3)!, creator: addressAt(word(log.data, 0)), quote: null, name: null, symbol: null };
    }
    if (topic0 === TOPICS.tokenLaunchedWithQuote && gen !== 6) {
      const quote = nonZero(addressAt(word(log.data, 3)));
      return { ...at, token: topicAddress(t2)!, curve: topicAddress(t3)!, creator: addressAt(word(log.data, 0)), quote, name: null, symbol: null };
    }
    if (topic0 === TOPICS.v6Launched && gen === 6) {
      return {
        ...at,
        token: topicAddress(t3)!,
        creator: topicAddress(t2)!,
        curve: addressAt(word(log.data, 0)),
        name: cleanText(stringAt(log.data, 1)),
        symbol: cleanText(stringAt(log.data, 2)),
        quote: nonZero(addressAt(word(log.data, 4))),
      };
    }
  } catch {
    return null; // malformed data: not a launch we can read
  }
  return null;
}

/** A graduation event: PoolGraduated from a gen 0/1/2 adapter, or a v6 curve's own event. */
export function decodeGraduationLog(log: RawLog): Graduation | null {
  if (log.blockNumber === null) return null;
  const block = Number(log.blockNumber);
  if (log.topics[0] === TOPICS.poolGraduated) {
    const fromAdapter = VIBE_FACTORIES.some((f) => f.adapter?.toLowerCase() === log.address.toLowerCase());
    const token = topicAddress(log.topics[1]);
    return fromAdapter && token ? { by: 'token', token, block } : null;
  }
  if (log.topics[0] === TOPICS.curveGraduated) return { by: 'curve', curve: getAddress(log.address), block };
  return null;
}

/** Token text as people should see it: no control characters, trimmed, at most 64 characters. */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return [...s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').trim()].slice(0, 64).join('');
}

// ------------------------------------------------------------------ the index

/** 2: adds gen 0 (an index without it is rebuilt from scratch). */
export const LAUNCH_INDEX_VERSION = 2;

export interface LaunchIndex {
  version: typeof LAUNCH_INDEX_VERSION;
  chainId: number;
  /** every block up to and including this one has been scanned */
  toBlock: number;
  /** unix seconds */
  generatedAt: number;
  /** oldest first */
  launches: Launch[];
  /** symbol of every quote asset that isn't ETH, by lower-case address */
  quoteSymbols: Record<string, string>;
}

export interface ScanResult {
  fromBlock: number;
  toBlock: number;
  launches: DecodedLaunch[];
  graduations: Graduation[];
}

export const emptyIndex = (chainId: number, toBlock: number): LaunchIndex => ({
  version: LAUNCH_INDEX_VERSION,
  chainId,
  toBlock,
  generatedAt: 0,
  launches: [],
  quoteSymbols: {},
});

const key = (a: string) => a.toLowerCase();
const before = (a: Pick<Launch, 'block' | 'logIndex'>, b: Pick<Launch, 'block' | 'logIndex'>) =>
  a.block !== b.block ? a.block < b.block : a.logIndex < b.logIndex;

/** Token addresses in a scan whose name/symbol still have to be read from the token. */
export const tokensNeedingNames = (scan: ScanResult, index?: LaunchIndex | null): Address[] => {
  const known = new Set((index?.launches ?? []).map((l) => key(l.token)));
  return [...new Set(scan.launches.filter((l) => l.name === null || l.symbol === null).map((l) => l.token))].filter((t) => !known.has(key(t)));
};

/**
 * Fold a scan into the index:
 * - one entry per token address, across every factory generation and overlapping scans: the
 *   earliest launch event wins (an address can't launch twice; a repeat is a re-scan);
 * - names from the event (v6) or from `names` (read from the token), else the address's start;
 * - graduations set `graduatedBlock` (by token for gen 0/1/2, by curve for v6); a graduation for
 *   a curve or token the index doesn't know is ignored.
 */
export function applyScan(
  prev: LaunchIndex,
  scan: ScanResult,
  names: ReadonlyMap<string, { name: string; symbol: string }> = new Map(),
  quoteSymbols: Record<string, string> = {},
  now = Math.floor(Date.now() / 1000),
): LaunchIndex {
  const byToken = new Map(prev.launches.map((l) => [key(l.token), l]));
  for (const d of scan.launches) {
    const old = byToken.get(key(d.token));
    if (old && !before(d, old)) continue;
    const read = names.get(key(d.token));
    const name = d.name ?? (read ? cleanText(read.name) : null) ?? old?.name ?? '';
    const symbol = d.symbol ?? (read ? cleanText(read.symbol) : null) ?? old?.symbol ?? '';
    byToken.set(key(d.token), {
      ...d,
      name: name || symbol || d.token.slice(0, 8),
      symbol: symbol || name || d.token.slice(2, 8).toUpperCase(),
      graduatedBlock: old?.graduatedBlock ?? null,
    });
  }
  const byCurve = new Map([...byToken.values()].map((l) => [key(l.curve), l]));
  for (const g of scan.graduations) {
    const l = g.by === 'token' ? byToken.get(key(g.token)) : byCurve.get(key(g.curve));
    if (!l) continue;
    if (l.graduatedBlock === null || g.block < l.graduatedBlock) {
      const next = { ...l, graduatedBlock: g.block };
      byToken.set(key(l.token), next);
      byCurve.set(key(l.curve), next);
    }
  }
  const launches = [...byToken.values()].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  return {
    version: LAUNCH_INDEX_VERSION,
    chainId: prev.chainId,
    toBlock: Math.max(prev.toBlock, scan.toBlock),
    generatedAt: now,
    launches,
    quoteSymbols: { ...prev.quoteSymbols, ...Object.fromEntries(Object.entries(quoteSymbols).map(([a, s]) => [key(a), cleanText(s)])) },
  };
}

/** Quote assets in the index whose symbol is still unknown (not ETH, a test stock or an indexed launch). */
export function quotesNeedingSymbols(index: LaunchIndex): Address[] {
  const launches = new Set(index.launches.map((l) => key(l.token)));
  const out = new Set<Address>();
  for (const l of index.launches) {
    if (!l.quote) continue;
    const k = key(l.quote);
    if (index.quoteSymbols[k] || launches.has(k) || stockOf(l.quote)) continue;
    out.add(l.quote);
  }
  return [...out];
}

// ------------------------------------------------------------------ quote assets

export type QuoteKind = 'eth' | 'stock' | 'launch' | 'token';

const stockOf = (a: string): TestnetToken | undefined => TESTNET_TOKENS.find((t) => key(t.address) === key(a));

/** What a launch is paired with: ETH, a test stock (or USDG), another launch's token, or some ERC-20. */
export function quoteOf(launch: Pick<Launch, 'quote'>, index: Pick<LaunchIndex, 'launches' | 'quoteSymbols'>, launchesByToken?: ReadonlyMap<string, Launch>) {
  if (!launch.quote) return { kind: 'eth' as QuoteKind, symbol: 'ETH', address: null };
  const stock = stockOf(launch.quote);
  if (stock) return { kind: (stock.kind === 'stock' || stock.kind === 'preipo' ? 'stock' : 'token') as QuoteKind, symbol: stock.id, address: launch.quote };
  const other = launchesByToken?.get(key(launch.quote)) ?? index.launches.find((l) => key(l.token) === key(launch.quote!));
  if (other) return { kind: 'launch' as QuoteKind, symbol: other.symbol, address: launch.quote };
  return { kind: 'token' as QuoteKind, symbol: index.quoteSymbols[key(launch.quote)] ?? `${launch.quote.slice(0, 6)}…`, address: launch.quote };
}

// ------------------------------------------------------------------ wire format

/** One launch as a compact row: [token, name, symbol, quote|'', creator, curve, gen, launchId, block, logIndex, graduatedBlock|0] */
export type LaunchRow = [string, string, string, string, string, string, number, number, number, number, number];

export interface LaunchIndexWire {
  version: typeof LAUNCH_INDEX_VERSION;
  chainId: number;
  toBlock: number;
  generatedAt: number;
  quoteSymbols: Record<string, string>;
  rows: LaunchRow[];
}

export function encodeIndex(index: LaunchIndex): LaunchIndexWire {
  return {
    version: index.version,
    chainId: index.chainId,
    toBlock: index.toBlock,
    generatedAt: index.generatedAt,
    quoteSymbols: index.quoteSymbols,
    rows: index.launches.map((l) => [l.token, l.name, l.symbol, l.quote ?? '', l.creator, l.curve, l.gen, l.launchId, l.block, l.logIndex, l.graduatedBlock ?? 0]),
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The index from its wire form; null when it isn't one this code understands. */
export function decodeIndex(json: unknown): LaunchIndex | null {
  const w = json as Partial<LaunchIndexWire> | null;
  if (!w || w.version !== LAUNCH_INDEX_VERSION || typeof w.toBlock !== 'number' || !Array.isArray(w.rows)) return null;
  const launches: Launch[] = [];
  for (const r of w.rows) {
    if (!Array.isArray(r) || r.length !== 11 || !ADDRESS.test(r[0]) || !ADDRESS.test(r[4]) || !ADDRESS.test(r[5])) return null;
    const [token, name, symbol, quote, creator, curve, gen, launchId, block, logIndex, graduated] = r;
    launches.push({
      token: token as Address,
      name: String(name),
      symbol: String(symbol),
      quote: quote ? (quote as Address) : null,
      creator: creator as Address,
      curve: curve as Address,
      gen: gen as LaunchGen,
      launchId,
      block,
      logIndex,
      graduatedBlock: graduated > 0 ? graduated : null,
    });
  }
  return {
    version: LAUNCH_INDEX_VERSION,
    chainId: Number(w.chainId),
    toBlock: w.toBlock,
    generatedAt: Number(w.generatedAt ?? 0),
    launches,
    quoteSymbols: w.quoteSymbols ?? {},
  };
}

/**
 * Where the published index lives: a release asset on this public repo, rebuilt on a schedule
 * by .github/workflows/launch-index.yml. Public data, no secret.
 */
export const LAUNCH_INDEX_URL = 'https://github.com/ace-coderr/prism/releases/download/launch-index/launches.json.gz';
