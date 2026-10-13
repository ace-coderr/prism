/**
 * Tokens verified on Robinhood Chain Testnet (chainId 46630).
 *
 * Every entry was (1) published for chain 46630 by the source in `sourceUrl`
 * and (2) checked on-chain via the testnet RPC: name(), symbol(), decimals()
 * and totalSupply() all succeeded (see packages/core/scripts/verify-tokens.ts).
 *
 * vibe/vibe test stocks: there is no official published address list yet. A vibe/vibe
 * admin confirmed in their Telegram (2026-10-04) that builders should use the test
 * stocks shown in the Discover tab of https://testnet.vibevibe.fun. The addresses below
 * come from the pair registry that page renders from (the `pairs` list in the site's
 * static bundle; the same tokens appear in /api/v1/chains/46630/board shelf and
 * /api/v1/chains/46630/v6/pair-prices). Verified 2026-10-04 at block ~128,549,000.
 *
 * What is NOT here, and why:
 * - Robinhood Stock Tokens: the docs' token table (https://docs.robinhood.com/chain/contracts)
 *   is generated from https://api.robinhood.com/rhj/assets, and all 194 assets there are
 *   deployed on mainnet (chainId 4663) only. None of those addresses has code on testnet.
 * - Other explorer look-alikes ("TSLA", "Mock … Stock Token", …): not published by
 *   Robinhood or vibe/vibe. Left out on purpose.
 * - Chainlink: Robinhood feeds exist on mainnet only, so every `priceFeed` is null.
 *   Prices come from the vibe/vibe API and the tokens' Uniswap V4 pools instead.
 */

export const VIBE_DISCOVER_SOURCE =
  'https://testnet.vibevibe.fun (Discover tab pair registry; /api/v1/chains/46630/v6/pair-prices)';
export const VIBE_ADMIN_NOTE = 'confirmed by vibe/vibe admin, Telegram 2026-10-04';

export interface TestnetToken {
  /** Unique key + chip label (two different tokens use the on-chain symbol SPCX). */
  id: string;
  /** On-chain symbol() */
  symbol: string;
  /** On-chain name() */
  name: string;
  address: `0x${string}`;
  decimals: number;
  /** Chainlink AggregatorV3 proxy on 46630, or null when no testnet feed exists. */
  priceFeed: `0x${string}` | null;
  /**
   * stock / preipo = vibe/vibe test assets (no value), crypto = ETH-like,
   * currency = test stablecoin, launchpad = vibe/vibe protocol token
   */
  kind: 'stock' | 'preipo' | 'crypto' | 'currency' | 'launchpad';
  /** The ETH-paired Uniswap V4 pool used for pricing and swaps, when one exists. */
  pool: { fee: number; tickSpacing: number; hooks: `0x${string}` } | null;
  /**
   * Reviewable test stocks: the short name PRISM shows (the on-chain name, with its disclaimer, is
   * kept for tooltips) and the ticker tile used instead of any company logo: its colour and the
   * abbreviation that fits small tiles. The colours are PRISM's own, not the companies'.
   */
  display?: { shortName: string; tileColor: string; tileAbbr: string };
  sourceUrl: string;
  note?: string;
}

export const TESTNET_CHAIN_ID = 46630;

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const ETH_3000 = { fee: 3000, tickSpacing: 60, hooks: ZERO };

export const TESTNET_TOKENS: readonly TestnetToken[] = [
  // --- vibe/vibe Discover test stocks (routed via ETH/token V4 pools, 0.3%) ---
  {
    id: 'NVDA',
    symbol: 'NVDA',
    name: 'NVIDIA (vibe/vibe test stock, no value)',
    display: { shortName: 'NVIDIA', tileColor: '#c08cff', tileAbbr: 'NVDA' },
    address: '0x3ab049897b0697BdA766D8730fe1F955c9c103F0',
    decimals: 18,
    priceFeed: null,
    kind: 'stock',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: VIBE_ADMIN_NOTE,
  },
  {
    id: 'SPCX',
    symbol: 'SPCX',
    name: 'SpaceX (vibe/vibe test stock, no value)',
    display: { shortName: 'SpaceX', tileColor: '#f6c143', tileAbbr: 'SPCX' },
    address: '0xba163e9887d54A854323B41fcA9cf64a1c275Ac9',
    decimals: 18,
    priceFeed: null,
    kind: 'stock',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: VIBE_ADMIN_NOTE,
  },
  {
    id: 'AAPL',
    symbol: 'AAPL',
    name: 'Apple (vibe/vibe test stock, no value)',
    display: { shortName: 'Apple', tileColor: '#6aa6ff', tileAbbr: 'AAPL' },
    address: '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2',
    decimals: 18,
    priceFeed: null,
    kind: 'stock',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: VIBE_ADMIN_NOTE,
  },
  {
    id: 'OPENAI',
    symbol: 'OPENAI',
    name: 'OpenAI (vibe/vibe test asset, no value, not equity)',
    display: { shortName: 'OpenAI', tileColor: '#ff7a5c', tileAbbr: 'OAI' },
    address: '0x1b14321750b38f7eD66A363D07a921A668521A5F',
    decimals: 18,
    priceFeed: null,
    kind: 'preipo',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: VIBE_ADMIN_NOTE,
  },
  {
    id: 'ANTHROPIC',
    symbol: 'ANTHROPIC',
    name: 'Anthropic (vibe/vibe test asset, no value, not equity)',
    display: { shortName: 'Anthropic', tileColor: '#3cc8b4', tileAbbr: 'ANTH' },
    address: '0x92dCe70B18df47ac643Af6377621D74aBE3C868C',
    decimals: 18,
    priceFeed: null,
    kind: 'preipo',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: VIBE_ADMIN_NOTE,
  },
  {
    id: 'USDG',
    symbol: 'USDG',
    name: 'Global Dollar',
    address: '0x102154E70D8485Ff466bab229bE90a763bF33264',
    decimals: 6,
    priceFeed: null,
    kind: 'currency',
    pool: ETH_3000,
    sourceUrl: VIBE_DISCOVER_SOURCE,
    note: `${VIBE_ADMIN_NOTE}; listed as "Global Dollar (testnet)" under currencies`,
  },
  // --- earlier step ---
  {
    id: 'WETH',
    symbol: 'WETH',
    name: 'WETH',
    address: '0x7943e237c7F95DA44E0301572D358911207852Fa',
    decimals: 18,
    priceFeed: null,
    kind: 'crypto',
    pool: null, // wrapped 1:1 — priced as 1 ETH
    sourceUrl: 'https://docs.robinhood.com/chain/protocol-contracts',
  },
  {
    id: 'SPCX·Seedify',
    symbol: 'SPCX',
    name: 'Seedify Mock Stock SPCX',
    address: '0x5a5398155d98374C0e26265eA3cb9818169C2739',
    decimals: 18,
    priceFeed: null,
    // Not offered in baskets: the Discover tab's SPCX is the SpaceX token above. On-chain,
    // 80 of 4,690 LaunchCreated events on the vibe/vibe v6 factory (0xe7942178…) use
    // 0xba163e98… (SpaceX) as quote and none use this one; it only appears once, as a
    // quote-asset registration on the older factory. Kept here for reference/pricing.
    kind: 'launchpad',
    pool: ETH_3000,
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
    note: 'legacy vibe/vibe quote asset (config.quoteAssets); NOT the Discover SPCX (SpaceX test stock)',
  },
  {
    id: 'tSFUND',
    symbol: 'tSFUND',
    name: 'Testnet SFUND',
    address: '0x728E721256D0708D23b00afCD32c096979259b16',
    decimals: 18,
    priceFeed: null,
    kind: 'launchpad',
    pool: ETH_3000,
    sourceUrl: 'https://testnet.vibevibe.fun/api/v1/chains/46630/config',
  },
];

/** Tokens that belong in a basket (stocks, pre-IPO test assets, ETH). */
export const BASKET_TOKENS = TESTNET_TOKENS.filter(
  (t) => t.kind === 'stock' || t.kind === 'preipo' || t.kind === 'crypto',
);

export const tokenById = (id: string) => TESTNET_TOKENS.find((t) => t.id === id);

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

/** A test stock's ticker tile, or null for anything else (launches have their own pictures). */
export function stockTile(address: string): { ticker: string; abbr: string; color: string } | null {
  const t = TESTNET_TOKENS.find((x) => x.address.toLowerCase() === address.toLowerCase());
  return t?.display ? { ticker: t.symbol, abbr: t.display.tileAbbr, color: t.display.tileColor } : null;
}

/**
 * The tile as SVG: the bold ticker on its solid colour (the 4-letter abbreviation below 64px so it
 * stays readable). Never a company logo.
 */
export function tickerTileSvg(tile: { ticker: string; abbr: string; color: string }, size: number): string {
  const text = size >= 64 ? tile.ticker : tile.abbr;
  const fontSize = Math.min(size * 0.36, (size * 0.8) / (text.length * 0.66));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${tile.color}"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Space Grotesk Light, Space Grotesk, Arial, sans-serif" font-weight="700" font-size="${fontSize.toFixed(1)}" letter-spacing="${(-fontSize * 0.02).toFixed(2)}" fill="#101214">${text}</text></svg>`;
}

/** The on-chain disclaimer as badges: "TEST STOCK · NO VALUE", and "NOT EQUITY" where the name says so. */
export const stockDisclaimers = (onchainName: string): string[] => ['TEST STOCK · NO VALUE', ...(/not equity/i.test(onchainName) ? ['NOT EQUITY'] : [])];
