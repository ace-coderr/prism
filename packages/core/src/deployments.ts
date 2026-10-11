import type { Address } from 'viem';

/**
 * Deployed PRISM contracts, keyed by chain id. Every contract is deployed by the owner from
 * their own browser wallet via the web app's dev-only /deploy page; no key ever touches PRISM.
 */
export interface PrismDeployment {
  /**
   * PrismProfiles (usernames, bios, X handles), deployed for the crystal app and kept: the
   * new PRISM reads usernames from it. Its avatar field points at legacy crystals and is
   * ignored; avatars are generated from the address (identicon.ts).
   */
  prismProfiles?: Address;
  /** PrismProfiles' creation transaction. */
  prismProfilesTx?: `0x${string}`;
  /**
   * LEGACY: the archived crystal app's contracts (branch archive/crystal-v1, tag crystal-v1).
   * Kept for the record only. They still work on-chain and nobody can turn them off, but
   * nothing in this app reads them or links to them.
   */
  legacy?: {
    prismCrystal: Address;
    prismCrystalTx: `0x${string}`;
    prismCrystalFromBlock: bigint;
    forgeRouter: Address;
    forgeRouterTx: `0x${string}`;
  };
}

export const DEPLOYMENTS: Partial<Record<number, PrismDeployment>> = {
  // Robinhood Chain Testnet: deployed from the owner's browser wallet
  // (0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e) via the /deploy page.
  46630: {
    // 2026-10-05, block 128964290
    prismProfiles: '0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300',
    prismProfilesTx: '0x4b51aa09788555c4acfa10609f9c4bd49ee529d3693706d9e3829aa4e06d7717',
    legacy: {
      // 2026-10-04
      prismCrystal: '0x59ce49dE3782FA87E94850b23FEB1457009f9f40',
      prismCrystalTx: '0xd2a73a5619ff9e3ac90ecb3ed9e02963af34ec360b41614a4b0fe0f480c86b57',
      prismCrystalFromBlock: 128575215n,
      // 2026-10-05, block 128964670
      forgeRouter: '0xD1340ad67A4b5C0995CC050bE773ee74293fD24D',
      forgeRouterTx: '0xefc1917f96d9ba23bca006d564ec85214e78fe15eccbc73a7cab02b570f8a7e7',
    },
  },
};

export function getDeployment(chainId: number): PrismDeployment | null {
  return DEPLOYMENTS[chainId] ?? null;
}
