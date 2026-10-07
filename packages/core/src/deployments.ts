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
  /** The router's creation transaction (for scripts/check-deployment.ts). */
  forgeRouterTx?: `0x${string}`;
  /**
   * PrismProfiles (usernames, crystal avatars, bios, X handles). Empty until deployed via
   * /deploy; everything profile-related in the app stays off until then.
   */
  prismProfiles?: Address;
  /** PrismProfiles' creation transaction (for scripts/check-deployment.ts). */
  prismProfilesTx?: `0x${string}`;
  /**
   * PrismGiftLinks (send a crystal as a link). Empty until deployed via /deploy; "Send as a
   * link" and /claim stay off until then.
   */
  giftLinks?: Address;
  /** PrismGiftLinks' creation transaction and block (link events are read from there). */
  giftLinksTx?: `0x${string}`;
  giftLinksFromBlock?: bigint;
}

export const DEPLOYMENTS: Partial<Record<number, PrismDeployment>> = {
  // Robinhood Chain Testnet — deployed 2026-10-04 from the owner's browser wallet
  // (deployer 0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e) via the /deploy page.
  46630: {
    prismCrystal: '0x59ce49dE3782FA87E94850b23FEB1457009f9f40',
    fromBlock: 128575215n,
    txHash: '0xd2a73a5619ff9e3ac90ecb3ed9e02963af34ec360b41614a4b0fe0f480c86b57',
    // 2026-10-05, from the same wallet via /deploy; source verified on the explorer, and the
    // runtime code checked byte for byte against the compiled contracts with these
    // constructor args (scripts/check-deployment.ts). Router: block 128964670.
    forgeRouter: '0xD1340ad67A4b5C0995CC050bE773ee74293fD24D',
    forgeRouterTx: '0xefc1917f96d9ba23bca006d564ec85214e78fe15eccbc73a7cab02b570f8a7e7',
    // PrismProfiles: block 128964290.
    prismProfiles: '0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300',
    prismProfilesTx: '0x4b51aa09788555c4acfa10609f9c4bd49ee529d3693706d9e3829aa4e06d7717',
  },
};

export function getDeployment(chainId: number): PrismDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}
