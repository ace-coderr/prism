import type { Address } from 'viem';

/**
 * Deployed PRISM contracts, keyed by chain id. Filled in after the owner deploys
 * PrismCrystal from their own wallet via the web app's /deploy page.
 * `fromBlock` is the deployment block — event scans start there.
 */
export interface PrismDeployment {
  prismCrystal: Address;
  fromBlock: bigint;
  txHash?: `0x${string}`;
}

export const DEPLOYMENTS: Partial<Record<number, PrismDeployment>> = {
  // 46630: { prismCrystal: '0x…', fromBlock: 0n, txHash: '0x…' },
};

export function getDeployment(chainId: number): PrismDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}
