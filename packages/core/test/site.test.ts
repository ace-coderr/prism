import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { SHARE_TEXT, SITE_URL, VIBE_REFERRAL, badgePath, cashtag, formatScore, vibeTokenUrl, xIntent } from '../src';

const TOKEN = getAddress('0xa56dd43b6b2963990e852d3144f689b8e3f26afb');
const SOMEONE = '0x7Ed162246748A218E0404542683eeE0FC08fE4bD';

describe('site links', () => {
  it('lives at seeprism.xyz only', () => {
    expect(SITE_URL).toBe('https://seeprism.xyz');
  });

  it('“Buy on vibe/vibe” carries PRISM’s invite, kept in one place', () => {
    expect(vibeTokenUrl(TOKEN)).toBe(`https://testnet.vibevibe.fun/token/${TOKEN}?ref=_ace_won&refWallet=VV1-ETAM4H6SGFH3U6ESHPQCRJEPTJ87WL92`);
    expect(vibeTokenUrl(TOKEN, SOMEONE)).toContain('ref=_ace_won');
  });

  it('never refers PRISM’s own wallet to itself', () => {
    expect(vibeTokenUrl(TOKEN, VIBE_REFERRAL.owner)).toBe(`https://testnet.vibevibe.fun/token/${TOKEN}`);
    expect(vibeTokenUrl(TOKEN, VIBE_REFERRAL.owner.toLowerCase())).not.toContain('ref=');
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
