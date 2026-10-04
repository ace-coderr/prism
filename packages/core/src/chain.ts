/** Robinhood Chain Testnet (chainId 46630). */
import { defineChain } from 'viem';

export const robinhoodChainTestnet = defineChain({
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
});

export const explorerTx = (hash: string) => `${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddressUrl = (address: string) =>
  `${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`;

// Verified testnet token addresses (with sources) live in ./tokens.ts.
