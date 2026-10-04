/**
 * Tokens verified on Robinhood Chain Testnet (chainId 46630).
 *
 * Every entry was (1) published for chain 46630 by the source in `sourceUrl`
 * and (2) checked on-chain via the testnet RPC: name(), symbol(), decimals()
 * and totalSupply() all succeeded (see packages/core/scripts/verify-tokens.ts).
 * Verified 2026-10-04 at block ~128,533,496.
 *
 * What is NOT here, and why:
 * - Robinhood Stock Tokens: the docs' token table (https://docs.robinhood.com/chain/contracts)
 *   is generated from https://api.robinhood.com/rhj/assets, and all 194 assets there are
 *   deployed on mainnet (chainId 4663) only. None of those addresses has code on testnet.
 * - The explorer lists many look-alike "TSLA"/"NVDA"/"Mock … Stock Token" contracts on
 *   testnet, but no Robinhood or vibe/vibe page publishes them, and the docs warn that a
 *   matching ticker at a different address is not a Robinhood Stock Token. Left out.
 * - Price feeds: Chainlink lists Robinhood Chain *Mainnet* feeds only
 *   (https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood); none of
 *   the 58 mainnet proxies exist on testnet. So every `priceFeed` below is null.
 */

export interface TestnetToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  /** Chainlink AggregatorV3 proxy on 46630, or null when no testnet feed exists. */
  priceFeed: `0x${string}` | null;
  /** stock = (mock) stock token, crypto = ETH-like, launchpad = vibe/vibe protocol token */
  kind: 'stock' | 'crypto' | 'launchpad';
  sourceUrl: string;
}

export const TESTNET_CHAIN_ID = 46630;

export const TESTNET_TOKENS: readonly TestnetToken[] = [
  {
    symbol: 'WETH',
    name: 'WETH',
    address: '0x7943e237c7F95DA44E0301572D358911207852Fa',
    decimals: 18,
    priceFeed: null,
    kind: 'crypto',
    sourceUrl: 'https://docs.robinhood.com/chain/protocol-contracts',
  },
  {
    symbol: 'SPCX',
    name: 'Seedify Mock Stock SPCX',
    address: '0x5a5398155d98374C0e26265eA3cb9818169C2739',
    decimals: 18,
    priceFeed: null,
    kind: 'stock',
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
  },
  {
    symbol: 'tSFUND',
    name: 'Testnet SFUND',
    address: '0x728E721256D0708D23b00afCD32c096979259b16',
    decimals: 18,
    priceFeed: null,
    kind: 'launchpad',
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
  },
];

/** Tokens that belong in a basket (stocks + ETH), i.e. what the Forge offers. */
export const BASKET_TOKENS = TESTNET_TOKENS.filter((t) => t.kind !== 'launchpad');

export const tokenBySymbol = (symbol: string) => TESTNET_TOKENS.find((t) => t.symbol === symbol);

/** Minimal Chainlink AggregatorV3 ABI for read-only price reads. */
export const AGGREGATOR_V3_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

/** Scale a raw feed answer to a float, rejecting non-positive or stale rounds. */
export function feedPrice(
  answer: bigint,
  decimals: number,
  updatedAt: bigint,
  nowSec: number,
  maxAgeSec = 3 * 24 * 3600,
): number | null {
  if (answer <= 0n || updatedAt <= 0n) return null;
  if (nowSec - Number(updatedAt) > maxAgeSec) return null;
  return Number(answer) / 10 ** decimals;
}
