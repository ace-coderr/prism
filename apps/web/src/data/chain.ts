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

async function load(): Promise<Extract<LiveTokens, { status: 'live' }>> {
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

  // prices are read on-chain only (V4 pools over the public RPC) — no third-party APIs
  const snap = await marketSnapshot(testnetClient, verified);
  return { status: 'live', tokens: verified.map((t) => ({ ...t, market: snap.get(t.id)! })) };
}

/** Live, read-only market view of the verified testnet basket tokens. */
export function useTestnetTokens(): LiveTokens {
  const [state, setState] = useState<LiveTokens>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    load()
      .then((s) => alive && setState(s))
      .catch((e: Error) => alive && setState({ status: 'error', message: e.message.split('\n')[0] ?? 'RPC error' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
