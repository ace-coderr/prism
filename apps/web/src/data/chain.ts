import { useEffect, useState } from 'react';
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem';
import {
  BASKET_TOKENS,
  extendHistory,
  readMarket,
  robinhoodChainTestnet,
  type MarketHistory,
  type Snapshot,
  type TestnetToken,
  type TokenMarket,
} from '@prism/core';

// Read-only client: eth_call / eth_getLogs only. No wallet, no keys, no transactions.
export const testnetClient = createPublicClient({
  chain: robinhoodChainTestnet,
  // The public RPC rejects large JSON-RPC batches (~50+ calls), and that error response
  // carries a duplicated CORS header ("*,*") that browsers block. Keep batches small.
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], {
    batch: { batchSize: 20 },
    retryCount: 3,
    retryDelay: 300,
  }),
}) as PublicClient;

export const explorerAddress = (a: string) => `${robinhoodChainTestnet.blockExplorers.default.url}/address/${a}`;

export interface LiveToken extends TestnetToken {
  market: TokenMarket;
}

export type LiveTokens =
  | { status: 'loading' }
  | {
      status: 'live';
      tokens: LiveToken[];
      /** Real swap-price history (48h, extended on demand); null until it has loaded. */
      history: MarketHistory | null;
    }
  | { status: 'error'; message: string };

type Live = Extract<LiveTokens, { status: 'live' }>;

/** A full snapshot is reused across pages for this long before it is read again. */
const FRESH_MS = 60_000;
/** History is never scanned further back than this (no indexer: every swap log is read). */
const MAX_HISTORY_BLOCKS = 14n * 86400n * 7n; // ~14 days at ~7 blocks/s

let latest: { state: Live; at: number; full: boolean } | null = null;
let running = false;
let verified: TestnetToken[] = [];
const listeners = new Set<(s: LiveTokens) => void>();

function publish(state: LiveTokens) {
  for (const l of listeners) l(state);
}

/**
 * Two passes: pool prices first (about a second), then the swap history (several
 * seconds), so prices show up without waiting for the history.
 */
async function refresh() {
  if (running) return;
  running = true;
  try {
    // drop any token that fails its on-chain check right now
    verified = (
      await Promise.all(
        BASKET_TOKENS.map((t) =>
          testnetClient
            .readContract({ address: t.address, abi: erc20Abi, functionName: 'totalSupply' })
            .then(() => t)
            .catch(() => null),
        ),
      )
    ).filter((t): t is TestnetToken => t !== null);
    const toState = (markets: Map<string, TokenMarket>, history: MarketHistory | null): Live => ({
      status: 'live',
      tokens: verified.map((t) => ({ ...t, market: markets.get(t.id)! })),
      history,
    });

    // prices are read on-chain only (V4 pools over the public RPC) — no third-party APIs
    if (!latest) {
      const quick = await readMarket(testnetClient, verified, { history: false });
      latest = { state: toState(quick.markets, null), at: Date.now(), full: false };
      publish(latest.state);
    }
    const full = await readMarket(testnetClient, verified);
    // keep any older history already loaded for an older crystal
    let history = full.history;
    const prev = latest?.state.history;
    if (history && prev && prev.fromBlock < history.fromBlock) {
      history = await extendHistory(testnetClient, history, verified, prev.fromBlock).catch(() => history);
    }
    latest = { state: toState(full.markets, history), at: Date.now(), full: true };
    publish(latest.state);
  } catch (e) {
    if (!latest) publish({ status: 'error', message: (e as Error).message.split('\n')[0] ?? 'RPC error' });
  } finally {
    running = false;
  }
}

/**
 * Show the cached snapshot's prices right away (no history yet). The live read still
 * runs and replaces them; it skips its quick price-only pass since prices are already up.
 */
export function seedFromSnapshot(s: Snapshot) {
  if (latest) return;
  const tokens = s.tokens
    .map((id) => BASKET_TOKENS.find((t) => t.id === id))
    .filter((t): t is TestnetToken => !!t && !!s.markets[t.id])
    .map((t) => ({ ...t, market: s.markets[t.id]! }));
  if (tokens.length === 0) return;
  verified = tokens;
  latest = { state: { status: 'live', tokens, history: null }, at: s.generatedAt * 1000, full: false };
  publish(latest.state);
}

let extending: Promise<void> | null = null;

/** Make sure the shared history reaches back to `block` (e.g. an older crystal's forge block). */
async function ensureHistoryFrom(block: bigint) {
  const h = latest?.state.history;
  if (!latest || !h || block >= h.fromBlock) return;
  const floor = h.toBlock > MAX_HISTORY_BLOCKS ? h.toBlock - MAX_HISTORY_BLOCKS : 0n;
  const from = block < floor ? floor : block;
  if (from >= h.fromBlock) return;
  if (extending) return extending;
  extending = extendHistory(testnetClient, h, verified, from)
    .then((history) => {
      if (!latest) return;
      latest = { ...latest, state: { ...latest.state, history } };
      publish(latest.state);
    })
    .catch(() => undefined)
    .finally(() => {
      extending = null;
    });
  return extending;
}

/**
 * Live, read-only market view of the verified testnet basket tokens (shared by every
 * page). Pass `historyFrom` to have the price history reach back to that block.
 */
export function useTestnetTokens(historyFrom?: bigint | null): LiveTokens {
  const [state, setState] = useState<LiveTokens>(() => latest?.state ?? { status: 'loading' });
  useEffect(() => {
    listeners.add(setState);
    if (latest) setState(latest.state);
    if (!latest?.full || Date.now() - latest.at > FRESH_MS) void refresh();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  const historyStart = state.status === 'live' ? state.history?.fromBlock : undefined;
  useEffect(() => {
    if (historyFrom != null && historyStart !== undefined && historyFrom < historyStart) void ensureHistoryFrom(historyFrom);
  }, [historyFrom, historyStart]);
  return state;
}
