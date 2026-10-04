import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { robinhoodChainTestnet } from '@prism/core';

/**
 * Injected wallets only (MetaMask, Rabby, …, discovered via EIP-6963).
 * PRISM never sees or stores keys: every transaction is signed in the user's wallet.
 */
export const wagmiConfig = createConfig({
  chains: [robinhoodChainTestnet],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  transports: {
    // the public RPC rejects JSON-RPC batches of ~50+ calls; keep them small
    [robinhoodChainTestnet.id]: http(robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 } }),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export const TARGET_CHAIN = robinhoodChainTestnet;
