import { describe, expect, it } from 'vitest';
import { SHARE, giftLinkText, giftLinkUrl, profileLink, xIntent } from '../src/data/share';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';

describe('Share on X', () => {
  it('links to the public profile by name, else by address', () => {
    expect(profileLink(ME, 'ace')).toBe('prism-crystal.vercel.app/u/ace');
    expect(profileLink(ME, null)).toBe(`prism-crystal.vercel.app/u/${ME}`);
  });

  it('writes each post word for word', () => {
    const link = profileLink(ME, 'ace');
    expect(SHARE.forged(link)).toBe(
      'I just forged a crystal on @holdprism 🔮 a stock basket you can hold. Built on @vibevibefun · prism-crystal.vercel.app/u/ace',
    );
    expect(SHARE.profile(link)).toBe('My PRISM profile 🔮 crystals, badges and gold seams: prism-crystal.vercel.app/u/ace  @holdprism');
    expect(SHARE.badge('First Forge', link)).toBe('Just earned the First Forge badge on @holdprism 🔮 prism-crystal.vercel.app/u/ace');
    expect(SHARE.gift(2n)).toBe('I just gifted a PRISM crystal 🎁🔮 prism-crystal.vercel.app/gift/2 @holdprism');
    expect(SHARE.replay(2n)).toBe("My PRISM crystal's journey 🔮 prism-crystal.vercel.app/replay/2 @holdprism");
    expect(SHARE.giftLink(giftLinkText('/claim/7#k=abc'))).toBe(
      'I just sent a PRISM crystal as a gift link 🎁 first to open it keeps it… prism-crystal.vercel.app/claim/7#k=abc @holdprism',
    );
    expect(giftLinkUrl('/claim/7#k=abc')).toBe('https://prism-crystal.vercel.app/claim/7#k=abc');
  });

  it('keeps a gift link’s key (#k=…) inside the post text, encoded', () => {
    const text = SHARE.giftLink(giftLinkText('/claim/7#k=abc'));
    expect(new URL(xIntent(text)).searchParams.get('text')).toBe(text);
    expect(xIntent(text)).toContain('%23k%3Dabc'); // the # is part of the text, not the X link's own fragment
  });

  it("opens X's post composer with the text encoded (emoji, @, spaces, ·)", () => {
    const text = SHARE.forged(profileLink(ME, 'ace'));
    const url = new URL(xIntent(text));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe(text);
    expect(xIntent('a b')).toBe('https://x.com/intent/post?text=a%20b');
  });
});
