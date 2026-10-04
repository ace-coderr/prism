import { useEffect, useState } from 'react';
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem';
import {
  BASKET_TOKENS,
  fetchVibePrices,
  marketSnapshot,
  robinhoodChainTestnet,
  type TestnetToken,
  type TokenMarket,
} from '@prism/core';

// Read-only client: eth_call / eth_getLogs only. No wallet, no keys, no transactions.
export const testnetClient = createPublicClient({
  chain: robinhoodChainTestnet,
  // the public RPC intermittently answers with a duplicated CORS header ("*,*"), which
  // browsers reject — retry those rather than failing the whole page
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: true, retryCount: 5, retryDelay: 300 }),
}) as PublicClient;

/** Same-origin proxy to https://testnet.vibevibe.fun/api/v1/chains/46630 (see vite.config.ts). */
const VIBE_PROXY = '/vibe-api';

export const explorerAddress = (a: string) => `${robinhoodChainTestnet.blockExplorers.default.url}/address/${a}`;

export interface LiveToken extends TestnetToken {
  market: TokenMarket;
}

export type LiveTokens =
  | { status: 'loading' }
  | { status: 'live'; tokens: LiveToken[]; usdPerEth: number | null; apiOk: boolean }
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

  const vibe = await fetchVibePrices(fetch, VIBE_PROXY).catch(() => null);
  const snap = await marketSnapshot(testnetClient, verified, vibe);
  return {
    status: 'live',
    tokens: verified.map((t) => ({ ...t, market: snap.get(t.id)! })),
    usdPerEth: vibe?.usdPerEth ?? null,
    apiOk: vibe !== null,
  };
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
