import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChainTestnet } from '@prism/core';

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
