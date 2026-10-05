import { describe, expect, it } from 'vitest';
import { SHARE, profileLink, xIntent } from '../src/data/share';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';

describe('Share on X', () => {
  it('links to the public profile by name, else by address', () => {
    expect(profileLink(ME, 'ace')).toBe('prism-crystal.vercel.app/u/ace');
    expect(profileLink(ME, null)).toBe(`prism-crystal.vercel.app/u/${ME}`);
  });

  it('writes the three posts word for word', () => {
    const link = profileLink(ME, 'ace');
    expect(SHARE.forged(link)).toBe(
      'I just forged a crystal on @holdprism 🔮 a stock basket you can hold. Built on @vibevibefun · prism-crystal.vercel.app/u/ace',
    );
    expect(SHARE.profile(link)).toBe('My PRISM profile 🔮 crystals, badges and gold seams: prism-crystal.vercel.app/u/ace  @holdprism');
    expect(SHARE.badge('First Forge', link)).toBe('Just earned the First Forge badge on @holdprism 🔮 prism-crystal.vercel.app/u/ace');
  });

  it("opens X's post composer with the text encoded (emoji, @, spaces, ·)", () => {
    const text = SHARE.forged(profileLink(ME, 'ace'));
    const url = new URL(xIntent(text));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe(text);
    expect(xIntent('a b')).toBe('https://x.com/intent/post?text=a%20b');
  });
});
