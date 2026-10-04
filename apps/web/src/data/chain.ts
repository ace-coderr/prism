import { useEffect, useState } from 'react';
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem';
import {
  BASKET_TOKENS,
  marketSnapshot,
  robinhoodChainTestnet,
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
  | { status: 'live'; tokens: LiveToken[] }
  | { status: 'error'; message: string };

type Live = Extract<LiveTokens, { status: 'live' }>;

/** A full snapshot is reused across pages for this long before it is read again. */
const FRESH_MS = 60_000;

let latest: { state: Live; at: number; full: boolean } | null = null;
let running = false;
const listeners = new Set<(s: LiveTokens) => void>();

function publish(state: LiveTokens) {
  for (const l of listeners) l(state);
}

/**
 * Two passes: pool prices first (about a second), then the 24h swap history (several
 * seconds), so prices show up without waiting for the history.
 */
async function refresh() {
  if (running) return;
  running = true;
  try {
    // drop any token that fails its on-chain check right now
    const verified = (
      await Promise.all(
        BASKET_TOKENS.map((t) =>
          testnetClient
            .readContract({ address: t.address, abi: erc20Abi, functionName: 'totalSupply' })
            .then(() => t)
            .catch(() => null),
        ),
      )
    ).filter((t): t is TestnetToken => t !== null);
    const toState = (snap: Map<string, TokenMarket>): Live => ({
      status: 'live',
      tokens: verified.map((t) => ({ ...t, market: snap.get(t.id)! })),
    });

    // prices are read on-chain only (V4 pools over the public RPC) — no third-party APIs
    if (!latest) {
      const quick = await marketSnapshot(testnetClient, verified, { history: false });
      latest = { state: toState(quick), at: Date.now(), full: false };
      publish(latest.state);
    }
    const full = await marketSnapshot(testnetClient, verified);
    latest = { state: toState(full), at: Date.now(), full: true };
    publish(latest.state);
  } catch (e) {
    if (!latest) publish({ status: 'error', message: (e as Error).message.split('\n')[0] ?? 'RPC error' });
  } finally {
    running = false;
  }
}

/** Live, read-only market view of the verified testnet basket tokens (shared by every page). */
export function useTestnetTokens(): LiveTokens {
  const [state, setState] = useState<LiveTokens>(() => latest?.state ?? { status: 'loading' });
  useEffect(() => {
    listeners.add(setState);
    if (latest) setState(latest.state);
    if (!latest?.full || Date.now() - latest.at > FRESH_MS) void refresh();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
