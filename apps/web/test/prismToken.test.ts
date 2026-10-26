import { describe, expect, it } from 'vitest';
import { getAddress, type Address } from 'viem';
import { PRISM_TOKEN, VIBE_REFERRAL } from '@prism/core';
import { assetInfoFrom } from '../server/reviewState';

/*
 * $PRISM is read from the chain like any other launch. The one thing the server does differently for
 * it is that reviews from PRISM's own wallets are labelled "Creator" and left out of the score, even
 * though only one of them launched it. That is checked against the server's own asset lookup.
 */
const idx = (token: Address, creator: Address, symbol = 'PRISM') =>
  ({
    assetByToken: new Map([[token.toLowerCase(), { symbol, name: symbol, kind: 'launch' }]]),
    launchByToken: new Map([[token.toLowerCase(), { creator, graduatedBlock: null }]]),
  }) as never;

describe('the server’s asset info for $PRISM', () => {
  it('names both owner wallets as the creator’s own, whichever one launched it', () => {
    for (const launcher of VIBE_REFERRAL.owners) {
      const info = assetInfoFrom(idx(PRISM_TOKEN!, launcher))(PRISM_TOKEN!)!;
      expect(info.creator).toBe(launcher);
      expect(info.creatorWallets).toEqual(VIBE_REFERRAL.owners);
    }
  });

  it('finds it however the address is cased', () => {
    const info = assetInfoFrom(idx(PRISM_TOKEN!, VIBE_REFERRAL.owners[1]!))(PRISM_TOKEN!.toLowerCase() as Address)!;
    expect(info.creatorWallets).toEqual(VIBE_REFERRAL.owners);
  });

  it('gives no other launch that treatment', () => {
    const other = getAddress('0x2222222222222222222222222222222222222222');
    const info = assetInfoFrom(idx(other, VIBE_REFERRAL.owners[1]!, 'MOON'))(other)!;
    expect(info.creatorWallets).toBeUndefined();
  });
});
