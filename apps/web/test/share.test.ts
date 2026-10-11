import { describe, expect, it } from 'vitest';
import { SHARE, profileLink, xIntent } from '../src/data/share';

const ME = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';

describe('Share on X', () => {
  it('links to the public profile by name, else by address', () => {
    expect(profileLink(ME, 'ace')).toBe('seeprism.vercel.app/u/ace');
    expect(profileLink(ME, null)).toBe(`seeprism.vercel.app/u/${ME}`);
  });

  it('writes each post word for word', () => {
    expect(SHARE.profile(profileLink(ME, 'ace'))).toBe('My PRISM profile: seeprism.vercel.app/u/ace  @holdprism');
  });

  it("opens X's post composer with the text encoded (emoji, @, spaces, ·)", () => {
    const text = `${SHARE.profile(profileLink(ME, 'ace'))} 🔮 ·`;
    const url = new URL(xIntent(text));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/post');
    expect(url.searchParams.get('text')).toBe(text);
    expect(xIntent('a b')).toBe('https://x.com/intent/post?text=a%20b');
  });
});
