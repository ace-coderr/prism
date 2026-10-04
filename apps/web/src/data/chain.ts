import { useEffect, useState } from 'react';
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem';
import {
  AGGREGATOR_V3_ABI,
  BASKET_TOKENS,
  feedPrice,
  robinhoodChainTestnet,
  type TestnetToken,
} from '@prism/core';

// Read-only client: eth_call only. No wallet, no keys, no transactions.
export const testnetClient = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: true }),
});

export const explorerAddress = (a: string) => `${robinhoodChainTestnet.blockExplorers.default.url}/address/${a}`;

export interface LiveToken extends TestnetToken {
  /** totalSupply read from chain just now, as a decimal string */
  supply: string;
  /** USD price from the token's Chainlink feed; null when there is no feed (or it is stale). */
  price: number | null;
}

export type LiveTokens =
  | { status: 'loading' }
  | { status: 'live'; tokens: LiveToken[]; block: bigint }
  | { status: 'error'; message: string };

async function readFeed(feed: `0x${string}`) {
  const [decimals, round] = await Promise.all([
    testnetClient.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: 'decimals' }),
    testnetClient.readContract({ address: feed, abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData' }),
  ]);
  return feedPrice(round[1], decimals, round[3], Math.floor(Date.now() / 1000));
}

async function loadTokens(): Promise<LiveToken[]> {
  const tokens = await Promise.all(
    BASKET_TOKENS.map(async (t) => {
      try {
        const supply = await testnetClient.readContract({ address: t.address, abi: erc20Abi, functionName: 'totalSupply' });
        const price = t.priceFeed ? await readFeed(t.priceFeed).catch(() => null) : null;
        return { ...t, supply: formatUnits(supply, t.decimals), price };
      } catch {
        return null; // failed on-chain check → drop, never show unverified tokens
      }
    }),
  );
  return tokens.filter((t): t is LiveToken => t !== null);
}

/** Live, read-only view of the verified testnet basket tokens. */
export function useTestnetTokens(): LiveTokens {
  const [state, setState] = useState<LiveTokens>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    Promise.all([loadTokens(), testnetClient.getBlockNumber()])
      .then(([tokens, block]) => alive && setState({ status: 'live', tokens, block }))
      .catch((e: Error) => alive && setState({ status: 'error', message: e.message.split('\n')[0] ?? 'RPC error' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
