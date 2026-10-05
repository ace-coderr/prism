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
  /**
   * PrismForgeRouter (forge from ETH in one transaction). Empty until it's deployed from
   * the owner's wallet via /deploy; the Forge page's "Start with ETH" stays off until then.
   */
  forgeRouter?: Address;
  /**
   * PrismProfiles (usernames, crystal avatars, bios, X handles). Empty until deployed via
   * /deploy; everything profile-related in the app stays off until then.
   */
  prismProfiles?: Address;
}

export const DEPLOYMENTS: Partial<Record<number, PrismDeployment>> = {
  // Robinhood Chain Testnet — deployed 2026-10-04 from the owner's browser wallet
  // (deployer 0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e) via the /deploy page.
  46630: {
    prismCrystal: '0x59ce49dE3782FA87E94850b23FEB1457009f9f40',
    fromBlock: 128575215n,
    txHash: '0xd2a73a5619ff9e3ac90ecb3ed9e02963af34ec360b41614a4b0fe0f480c86b57',
  },
};

export function getDeployment(chainId: number): PrismDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}
