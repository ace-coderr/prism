/**
 * Robinhood Chain Testnet configuration. Not used yet — wallet / contract
 * wiring arrives in step 2.
 */
export const robinhoodChainTestnet = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://explorer.testnet.chain.robinhood.com' },
  },
  testnet: true,
} as const;

/**
 * Stock token contract addresses, keyed by ticker.
 *
 * TODO(step 2): fill from the official list at https://docs.robinhood.com/chain/contracts
 * Do not guess addresses — leave entries out until verified against the docs.
 */
export const STOCK_TOKEN_ADDRESSES: Partial<Record<string, `0x${string}`>> = {};
