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

// Verified testnet token addresses (with sources) live in ./tokens.ts.
