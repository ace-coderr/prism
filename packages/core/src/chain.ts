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

/** Robinhood Chain mainnet (4663) — used read-only (e.g. NFTs that live only on mainnet). */
export const robinhoodChainMainnet = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
});

export const explorerTx = (hash: string) => `${robinhoodChainTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddressUrl = (address: string) =>
  `${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`;

// Verified testnet token addresses (with sources) live in ./tokens.ts.
