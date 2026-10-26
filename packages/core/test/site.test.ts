import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { PRISM_TOKEN, SHARE_TEXT, SITE_URL, VIBE_REFERRAL, badgePath, cashtag, formatScore, vibeTokenUrl, xIntent } from '../src';

const TOKEN = getAddress('0xa56dd43b6b2963990e852d3144f689b8e3f26afb');
/** Not a wallet of PRISM's: anyone else. (This used to be the wallet $PRISM now launches from.) */
const SOMEONE = getAddress('0x1111111111111111111111111111111111111111');
const OWNER = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';
const LAUNCH_WALLET = '0x7Ed162246748A218E0404542683eeE0FC08fE4bD';

describe('site links', () => {
  it('lives at seeprism.xyz only', () => {
    expect(SITE_URL).toBe('https://seeprism.xyz');
  });

  it('“Buy on vibe/vibe” carries PRISM’s invite, kept in one place', () => {
    expect(vibeTokenUrl(TOKEN)).toBe(`https://testnet.vibevibe.fun/token/${TOKEN}?ref=_ace_won&refWallet=VV1-ETAM4H6SGFH3U6ESHPQCRJEPTJ87WL92`);
    expect(vibeTokenUrl(TOKEN, SOMEONE)).toContain('ref=_ace_won');
  });

  it('never refers PRISM’s own wallets to themselves: the owner’s and the $PRISM launch wallet', () => {
    // named here, not read from the list, so dropping either from VIBE_REFERRAL.owners fails
    for (const mine of [OWNER, LAUNCH_WALLET]) {
      expect(VIBE_REFERRAL.owners).toContain(mine);
      // however the wallet reports its address
      for (const as of [mine, mine.toLowerCase(), mine.toUpperCase().replace('0X', '0x'), getAddress(mine.toLowerCase())]) {
        const url = vibeTokenUrl(TOKEN, as);
        expect(url, as).toBe(`https://testnet.vibevibe.fun/token/${TOKEN}`);
        expect(url, as).not.toMatch(/ref=|refWallet=|\?/);
      }
    }
  });

  it('lists PRISM’s wallets as real, correctly checksummed addresses (a typo would refer the wallet after all)', () => {
    expect(VIBE_REFERRAL.owners.length).toBeGreaterThanOrEqual(2);
    for (const a of VIBE_REFERRAL.owners) expect(getAddress(a)).toBe(a);
    expect(new Set(VIBE_REFERRAL.owners.map((a) => a.toLowerCase())).size).toBe(VIBE_REFERRAL.owners.length);
  });

  it('still invites everyone else, even a wallet one character away from PRISM’s', () => {
    expect(vibeTokenUrl(TOKEN, SOMEONE)).toContain('ref=_ace_won&refWallet=');
    expect(vibeTokenUrl(TOKEN, null)).toContain('ref=_ace_won'); // not connected: nobody to tell apart
    const nearly = `${LAUNCH_WALLET.slice(0, -1)}${LAUNCH_WALLET.endsWith('D') ? 'C' : 'D'}`;
    expect(vibeTokenUrl(TOKEN, nearly)).toContain('ref=_ace_won');
    expect(vibeTokenUrl(TOKEN, LAUNCH_WALLET.slice(0, 20))).toContain('ref=_ace_won'); // no prefix matching
  });

  it('$PRISM is the live launch, stored as a checksummed address', () => {
    expect(PRISM_TOKEN).toBe('0x56C3044E212168C8D6517Cc09b0050F5C26aDaCF');
    expect(getAddress(PRISM_TOKEN!)).toBe(PRISM_TOKEN);
  });

  it('its vibe/vibe page carries no referral for either owner wallet, and the invite for anyone else', () => {
    const page = `https://testnet.vibevibe.fun/token/${PRISM_TOKEN}`;
    for (const mine of [OWNER, LAUNCH_WALLET]) {
      for (const as of [mine, mine.toLowerCase(), `0x${mine.slice(2).toUpperCase()}`]) expect(vibeTokenUrl(PRISM_TOKEN!, as), as).toBe(page);
    }
    expect(vibeTokenUrl(PRISM_TOKEN!, SOMEONE)).toBe(`${page}?ref=_ace_won&refWallet=VV1-ETAM4H6SGFH3U6ESHPQCRJEPTJ87WL92`);
    expect(vibeTokenUrl(PRISM_TOKEN!)).toContain('ref=_ace_won');
  });

  it('writes the share posts word for word', () => {
    expect(SHARE_TEXT.review('BULO', 4, 12)).toBe('I hold $BULO and gave it ★4 on @holdprism. If I sell, it\'ll say SOLD 👀 seeprism.xyz/r/12');
    expect(SHARE_TEXT.launch('BULO', 4.2, 12, TOKEN)).toBe(`$BULO true colors: 4.2 from 12 holders who are still in. seeprism.xyz/t/${TOKEN} @holdprism`);
    expect(SHARE_TEXT.launch('X', 3, 1, TOKEN)).toContain('from 1 holder who is still in');
    expect(cashtag('$Moon Dog')).toBe('$MoonDog');
    expect(formatScore(4.25)).toBe('4.3');
    expect(formatScore(3)).toBe('3.0');
    expect(badgePath(TOKEN)).toBe(`/badge/${TOKEN}.svg`);
    const text = SHARE_TEXT.review('BULO', 5, 1);
    expect(new URL(xIntent(text)).searchParams.get('text')).toBe(text);
  });
});
