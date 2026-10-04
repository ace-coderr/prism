/**
 * Read-only views of real PRISM crystals and of the live basket, shared by the web app
 * (in the browser) and the /api/snapshot function (on the server). Takes a viem
 * PublicClient; never signs or sends anything.
 */
import { erc20Abi, formatUnits, getAbiItem, type Address, type PublicClient } from 'viem';
import { prismCrystalAbi } from './abi/prismCrystal';
import type { CrystalHistory, Holding } from './crystal';
import type { PrismDeployment } from './deployments';
import { crystalHistory, priceAt } from './history';
import { usdHistory, type MarketHistory, type TokenMarket } from './market';
import { blockRanges, ownedFromTransfers, valueWeights, type TransferLog } from './onchain';
import type { PricePoint } from './pool';
import { TESTNET_TOKENS, tokenById, type TestnetToken } from './tokens';

/** getLogs range per request; 500k blocks stayed within the public RPC's limits in testing. */
export const LOG_RANGE = 400_000n;
const transferEvent = getAbiItem({ abi: prismCrystalAbi, name: 'Transfer' });
const forgedEvent = getAbiItem({ abi: prismCrystalAbi, name: 'Forged' });

export interface CrystalAsset {
  token: Address | null; // null = native ETH
  symbol: string;
  decimals: number;
  amount: bigint;
}

export interface OnchainCrystal {
  id: bigint;
  assets: CrystalAsset[];
  sealedUntil: number; // unix seconds, 0 = never sealed
  /** Block of the forge transaction (its Forged event); null if it couldn't be read. */
  forgedBlock: bigint | null;
  /** What went in when it was forged (the Forged event), for forge-time weights. */
  forgedWith: CrystalAsset[];
}

export interface PublicCrystal extends OnchainCrystal {
  owner: Address;
}

interface ForgeRecord {
  block: bigint;
  assets: CrystalAsset[];
  owner: Address;
}

const known = new Map(TESTNET_TOKENS.map((t) => [t.address.toLowerCase(), t]));

/** The listed test token behind a crystal asset (native ETH → WETH's prices). */
export const tokenOfAsset = (a: { token: Address | null }): TestnetToken | undefined =>
  a.token ? known.get(a.token.toLowerCase()) : tokenById('WETH');

async function tokenMeta(client: PublicClient, token: Address) {
  const k = known.get(token.toLowerCase());
  if (k) return { symbol: k.id, decimals: k.decimals };
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => `${token.slice(0, 6)}…`),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { symbol, decimals };
}

/**
 * Forged events (block + what went in), for the given ids or for every crystal,
 * read in RPC-safe block ranges from the deployment block.
 */
async function forgeRecords(client: PublicClient, d: PrismDeployment, ids?: bigint[]): Promise<Map<bigint, ForgeRecord>> {
  const out = new Map<bigint, ForgeRecord>();
  if (ids && ids.length === 0) return out;
  const head = await client.getBlockNumber();
  for (const [a, b] of blockRanges(d.fromBlock, head, LOG_RANGE)) {
    const logs = await client.getLogs({
      address: d.prismCrystal,
      event: forgedEvent,
      args: ids ? { id: ids } : undefined,
      fromBlock: a,
      toBlock: b,
    });
    for (const l of logs) {
      const tokens = l.args.tokens ?? [];
      const received = l.args.received ?? [];
      const assets: CrystalAsset[] = await Promise.all(
        tokens.map(async (token, i) => ({ token, amount: received[i] ?? 0n, ...(await tokenMeta(client, token)) })),
      );
      if ((l.args.eth ?? 0n) > 0n) assets.push({ token: null, symbol: 'ETH', decimals: 18, amount: l.args.eth! });
      out.set(l.args.id!, { block: l.blockNumber!, assets, owner: l.args.owner! });
    }
  }
  return out;
}

async function transferLogs(client: PublicClient, d: PrismDeployment, owner: Address): Promise<TransferLog[]> {
  const head = await client.getBlockNumber();
  const out: TransferLog[] = [];
  for (const [a, b] of blockRanges(d.fromBlock, head, LOG_RANGE)) {
    // ids that ever moved to or from the owner; replaying both directions gives current ownership
    const [ins, outs] = await Promise.all([
      client.getLogs({ address: d.prismCrystal, event: transferEvent, args: { to: owner }, fromBlock: a, toBlock: b }),
      client.getLogs({ address: d.prismCrystal, event: transferEvent, args: { from: owner }, fromBlock: a, toBlock: b }),
    ]);
    for (const l of [...ins, ...outs]) {
      out.push({ from: l.args.from!, to: l.args.to!, tokenId: l.args.tokenId!, blockNumber: l.blockNumber!, logIndex: l.logIndex! });
    }
  }
  return out;
}

/** One crystal's contents and seal, read from the contract. */
async function readCrystal(client: PublicClient, d: PrismDeployment, id: bigint, forged?: ForgeRecord): Promise<OnchainCrystal> {
  const [[tokens, balances, eth], sealed] = await Promise.all([
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'holdings', args: [id] }),
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'sealedUntil', args: [id] }),
  ]);
  const assets: CrystalAsset[] = await Promise.all(
    tokens.map(async (token, i) => ({ token, amount: balances[i]!, ...(await tokenMeta(client, token)) })),
  );
  if (eth > 0n) assets.push({ token: null, symbol: 'ETH', decimals: 18, amount: eth });
  return { id, assets, sealedUntil: Number(sealed), forgedBlock: forged?.block ?? null, forgedWith: forged?.assets ?? [] };
}

/** The crystals `owner` holds right now. */
export async function readCrystalsOf(client: PublicClient, d: PrismDeployment, owner: Address): Promise<OnchainCrystal[]> {
  const ids = ownedFromTransfers(await transferLogs(client, d, owner), owner);
  const forged = await forgeRecords(client, d, ids).catch(() => new Map<bigint, ForgeRecord>());
  return Promise.all(ids.map((id) => readCrystal(client, d, id, forged.get(id))));
}

/**
 * Every crystal ever forged that still exists (Forged events, then current owner and
 * contents; burned ones are skipped), plus how many were forged in total.
 */
export async function readAllCrystals(client: PublicClient, d: PrismDeployment): Promise<{ crystals: PublicCrystal[]; forged: number }> {
  const forged = await forgeRecords(client, d);
  const rows = await Promise.all(
    [...forged.entries()].map(async ([id, rec]) => {
      const owner = await client
        .readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'ownerOf', args: [id] })
        .catch(() => null); // burned
      if (!owner) return null;
      return { ...(await readCrystal(client, d, id, rec)), owner };
    }),
  );
  const crystals = rows.filter((r): r is PublicCrystal => r !== null).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { crystals, forged: forged.size };
}

/** Earliest forge block among crystals (how far back their price history must reach). */
export const earliestForge = (crystals: OnchainCrystal[] | undefined) =>
  (crystals ?? []).reduce<bigint | null>((m, c) => (c.forgedBlock !== null && (m === null || c.forgedBlock < m) ? c.forgedBlock : m), null);

// ---------------------------------------------------------------------------
// Crystal shapes from real prices
// ---------------------------------------------------------------------------

/** Shape-only default when there is no price history to measure how jumpy a price is. */
export const DEFAULT_VOLATILITY = 0.4;

/** When a crystal was forged (unix s), if its forge block is inside the loaded history. */
export function forgedAt(history: MarketHistory | null, crystal: OnchainCrystal): number | null {
  if (!history || crystal.forgedBlock === null || crystal.forgedBlock < history.fromBlock) return null;
  return history.clock(crystal.forgedBlock);
}

/** Cracks and gold seams for a real crystal: each holding's real drops since its forge block. */
export function crystalHistoryOf(history: MarketHistory | null, crystal: OnchainCrystal): CrystalHistory | undefined {
  const since = forgedAt(history, crystal);
  if (!history || since === null) return undefined;
  const series = new Map<string, PricePoint[]>();
  for (const a of crystal.assets) {
    const t = tokenOfAsset(a);
    series.set(a.symbol, t ? usdHistory(history, t) : []);
  }
  return crystalHistory(series, since);
}

/** Weights at forge time: what went in (Forged event) valued at the prices of the forge block. */
export function forgeWeightsOf(history: MarketHistory | null, crystal: OnchainCrystal): Map<string, number> | null {
  const since = forgedAt(history, crystal);
  if (!history || since === null || crystal.forgedWith.length === 0) return null;
  const values = crystal.forgedWith.map((a) => {
    const t = tokenOfAsset(a);
    const usd = t ? priceAt(usdHistory(history, t), since) : null;
    return usd === null ? null : Number(formatUnits(a.amount, a.decimals)) * usd;
  });
  const w = valueWeights(values);
  return new Map(crystal.forgedWith.map((a, i) => [a.symbol, w[i]!]));
}

/** A crystal's holdings, weighted by live value in ETH (no price → an average share). */
export function holdingsOf(
  assets: CrystalAsset[],
  marketOf: (a: CrystalAsset) => TokenMarket | undefined,
): { holdings: Holding[]; totalEth: number; values: Array<number | null> } {
  const values = assets.map((a) => {
    const m = marketOf(a);
    return m?.eth != null ? Number(formatUnits(a.amount, a.decimals)) * m.eth : null;
  });
  const weights = valueWeights(values);
  const holdings = assets.map((a, i) => ({
    symbol: a.symbol,
    weight: weights[i]!,
    change24h: marketOf(a)?.change24h ?? Number.NaN,
    volatility: marketOf(a)?.volatility ?? DEFAULT_VOLATILITY,
  }));
  return { holdings, totalEth: values.reduce<number>((s, v) => s + (v ?? 0), 0), values };
}

/** The live Home basket: equal parts of each real testnet asset. */
export const LIVE_BASKET = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI', 'WETH'] as const;

export interface LiveBasket {
  holdings: Holding[];
  history: CrystalHistory;
  /** hours of history the cracks and seams come from */
  hours: number;
}

/**
 * Holdings + history for the live Home crystal, all real: 24h moves and jumpiness from
 * the pools, cracks / gold seams from the pools' real drops over the loaded history.
 */
export function liveBasketOf(markets: Map<string, TokenMarket>, history: MarketHistory): LiveBasket | null {
  const tokens = LIVE_BASKET.map((id) => tokenById(id)).filter((t): t is TestnetToken => !!t && markets.has(t.id));
  if (tokens.length === 0) return null;
  const holdings: Holding[] = tokens.map((t) => ({
    symbol: t.id,
    weight: 1 / tokens.length,
    change24h: markets.get(t.id)!.change24h ?? Number.NaN,
    volatility: markets.get(t.id)!.volatility ?? DEFAULT_VOLATILITY,
  }));
  const start = history.clock(history.fromBlock);
  const series = new Map(tokens.map((t) => [t.id, usdHistory(history, t)]));
  return { holdings, history: crystalHistory(series, start), hours: Math.round((history.nowSec - start) / 3600) };
}
