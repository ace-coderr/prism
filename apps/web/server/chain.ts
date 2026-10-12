/**
 * The read-only RPC client every server function uses. PRISM_RPC_URL points it at another node
 * (a local fork in tests); production reads Robinhood Chain Testnet's public RPC.
 */
import { createPublicClient, http, type PublicClient } from 'viem';
import { robinhoodChainMainnet, robinhoodChainTestnet } from '@prism/core';

export const client = createPublicClient({
  chain: robinhoodChainTestnet,
  transport: http(process.env.PRISM_RPC_URL || robinhoodChainTestnet.rpcUrls.default.http[0], { batch: { batchSize: 20 }, retryCount: 3, retryDelay: 300 }),
}) as PublicClient;

/** Robinhood Chain mainnet, read-only: only for Chainlink's ETH/USD price (PRISM_MAINNET_RPC_URL overrides). */
export const mainnetClient = createPublicClient({
  chain: robinhoodChainMainnet,
  transport: http(process.env.PRISM_MAINNET_RPC_URL || robinhoodChainMainnet.rpcUrls.default.http[0], { retryCount: 2, retryDelay: 300, timeout: 10_000 }),
}) as PublicClient;

/** JSON with bigints as decimal strings. */
export const json = (body: unknown) => JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
