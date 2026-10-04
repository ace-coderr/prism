/**
 * The Home snapshot: everything the first screen needs, read from the chain in one go
 * (prices, 24h moves, the live basket's cracks and seams, every crystal and the live
 * stats). The /api/snapshot function builds it server-side and the CDN caches it, so a
 * first visit renders instantly; the browser then refreshes live in the background.
 * JSON-safe: bigints travel as decimal strings.
 */
import { erc20Abi, formatUnits, type Address, type PublicClient } from 'viem';
import { prismCrystalAbi } from './abi/prismCrystal';
import type { CrystalHistory } from './crystal';
import type { PrismDeployment } from './deployments';
import { extendHistory, readMarket, type TokenMarket } from './market';
import {
  crystalHistoryOf,
  earliestForge,
  liveBasketOf,
  readAllCrystals,
  type CrystalAsset,
  type LiveBasket,
  type PublicCrystal,
} from './reader';
import { BASKET_TOKENS, type TestnetToken } from './tokens';

export const SNAPSHOT_VERSION = 1;
/** Price history is never scanned further back than this (~14 days at ~7 blocks/s). */
export const MAX_HISTORY_BLOCKS = 14n * 86400n * 7n;

interface WireAsset {
  token: Address | null;
  symbol: string;
  decimals: number;
  amount: string;
}

export interface WireCrystal {
  id: string;
  owner: Address;
  assets: WireAsset[];
  sealedUntil: number;
  forgedBlock: string | null;
  forgedWith: WireAsset[];
  /** cracks and seams from real prices since its forge block, when known */
  history: CrystalHistory | null;
}

export interface Snapshot {
  version: typeof SNAPSHOT_VERSION;
  /** unix seconds when the server read the chain */
  generatedAt: number;
  block: string;
  /** basket tokens that passed their on-chain check, in order */
  tokens: string[];
  markets: Record<string, TokenMarket>;
  basket: LiveBasket | null;
  stats: { forged: number | null; owners: number | null; ethHeld: number | null; stocks: number };
  crystals: WireCrystal[] | null;
}

const wireAsset = (a: CrystalAsset): WireAsset => ({ ...a, amount: a.amount.toString() });

/** Read everything Home, Gallery and the Forge price list need. */
export async function buildSnapshot(
  client: PublicClient,
  deployment: PrismDeployment | null,
  candidates: readonly TestnetToken[] = BASKET_TOKENS,
): Promise<Snapshot> {
  const verified = (
    await Promise.all(
      candidates.map((t) =>
        client
          .readContract({ address: t.address, abi: erc20Abi, functionName: 'totalSupply' })
          .then(() => t)
          .catch(() => null),
      ),
    )
  ).filter((t): t is TestnetToken => t !== null);

  const [view, all, ethHeld, head] = await Promise.all([
    readMarket(client, verified),
    deployment ? readAllCrystals(client, deployment).catch(() => null) : null,
    deployment
      ? client.readContract({ address: deployment.prismCrystal, abi: prismCrystalAbi, functionName: 'totalEthRecorded' }).catch(() => null)
      : null,
    client.getBlockNumber(),
  ]);

  // reach back to the oldest crystal's forge block (capped), so every crystal gets its seams
  let history = view.history;
  const oldest = earliestForge(all?.crystals);
  if (history && oldest !== null && oldest < history.fromBlock) {
    const floor = history.toBlock > MAX_HISTORY_BLOCKS ? history.toBlock - MAX_HISTORY_BLOCKS : 0n;
    history = await extendHistory(client, history, verified, oldest < floor ? floor : oldest).catch(() => history);
  }

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: Math.floor(Date.now() / 1000),
    block: head.toString(),
    tokens: verified.map((t) => t.id),
    markets: Object.fromEntries(view.markets),
    basket: view.history ? liveBasketOf(view.markets, view.history) : null,
    stats: {
      forged: all?.forged ?? null,
      owners: all ? new Set(all.crystals.map((c) => c.owner.toLowerCase())).size : null,
      ethHeld: ethHeld === null ? null : Number(formatUnits(ethHeld, 18)),
      stocks: verified.filter((t) => t.kind !== 'crypto').length,
    },
    crystals: all
      ? all.crystals.map((c) => ({
          id: c.id.toString(),
          owner: c.owner,
          assets: c.assets.map(wireAsset),
          sealedUntil: c.sealedUntil,
          forgedBlock: c.forgedBlock?.toString() ?? null,
          forgedWith: c.forgedWith.map(wireAsset),
          history: crystalHistoryOf(history, c) ?? null,
        }))
      : null,
  };
}

const assetFromWire = (a: WireAsset): CrystalAsset => ({ ...a, amount: BigInt(a.amount) });

/** A snapshot crystal back in app form (bigints restored), with its server-side history. */
export function crystalFromWire(c: WireCrystal): PublicCrystal & { history: CrystalHistory | null } {
  return {
    id: BigInt(c.id),
    owner: c.owner,
    assets: c.assets.map(assetFromWire),
    sealedUntil: c.sealedUntil,
    forgedBlock: c.forgedBlock === null ? null : BigInt(c.forgedBlock),
    forgedWith: c.forgedWith.map(assetFromWire),
    history: c.history,
  };
}

/** Validate JSON from /api/snapshot; null when it isn't a snapshot this app understands. */
export function parseSnapshot(json: unknown): Snapshot | null {
  if (!json || typeof json !== 'object') return null;
  const s = json as Partial<Snapshot>;
  if (s.version !== SNAPSHOT_VERSION || typeof s.generatedAt !== 'number' || !s.markets || !Array.isArray(s.tokens)) return null;
  // JSON has no NaN: an unknown 24h move arrives as null
  if (s.basket) s.basket.holdings = s.basket.holdings.map((h) => ({ ...h, change24h: h.change24h ?? Number.NaN }));
  return s as Snapshot;
}
