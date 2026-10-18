import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withMeta } from '../server/page';
import { badgeSvg, wrap } from '../server/svg';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('share-ready pages', () => {
  it('puts the page’s own title, description and image in the tags link previews read', () => {
    const out = withMeta(html, {
      title: '$BULO true colors: 4.2 from 12 holders · PRISM',
      description: 'What $BULO (bulo) holders “really” think & more <3',
      path: '/t/0xabc',
      image: 'https://seeprism.xyz/api/og/t/0xabc.png',
    });
    expect(out).toContain('<title>$BULO true colors: 4.2 from 12 holders · PRISM</title>');
    expect(out).toContain('<meta property="og:url" content="https://seeprism.xyz/t/0xabc" />');
    expect(out).toContain('<meta property="og:image" content="https://seeprism.xyz/api/og/t/0xabc.png" />');
    expect(out).toContain('<meta property="og:image:type" content="image/png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://seeprism.xyz/api/og/t/0xabc.png" />');
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // escaped, so a review's text can't break out of the attribute
    expect(out).toContain('content="What $BULO (bulo) holders “really” think &amp; more &lt;3"');
    expect(out).not.toContain('prism-crystal');
  });

  it('keeps $-patterns, quotes and markup in names and review text literal (a token named "$1INCH" used to corrupt the page)', () => {
    for (const evil of ['$1INCH', "$'", '$`', '$&', '$$', '$1$2', `"quoted" 'single'`, '</title><script>alert(1)</script>', '"><img src=x onerror=alert(1)>']) {
      const out = withMeta(html, { title: `${evil} on PRISM`, description: `“${evil}”`, path: '/r/7', image: 'https://seeprism.xyz/api/og/r/7.png' });
      // exactly one title, and the page's own tags intact
      expect(out.match(/<title>/g)).toHaveLength(1);
      expect(out.match(/<\/title>/g)).toHaveLength(1);
      expect(out).not.toContain('<script>alert');
      expect(out).not.toContain('<img src=x');
      expect(out).toContain('<meta property="og:url" content="https://seeprism.xyz/r/7" />');
      expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
      // what was written comes back, escaped but not rewritten
      const esc = evil.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      expect(out).toContain(`<title>${esc} on PRISM</title>`);
      expect(out).toContain(`<meta property="og:description" content="“${esc}”" />`);
      expect(out.length).toBeLessThan(html.length + 2000); // no copies of the page pulled in by $` or $'
    }
  });
});

describe('share images', () => {
  it('wraps review text to fit, with … when cut, and drops emoji the fonts can’t draw', () => {
    expect(wrap('one two three four five six', 9, 2)).toEqual(['one two', 'three…']);
    expect(wrap('Diamond hands 💎', 40, 2)).toEqual(['Diamond hands']);
    expect(wrap('', 10, 2)).toEqual([]);
  });

  it('badge says the score, or how far from one a token is', () => {
    expect(badgeSvg('BULO', { score: 4.23, reviewers: 12, sold: 1, confidence: 'high', total: 13 })).toContain('★4.2 · 12 holders');
    expect(badgeSvg('NEW', { score: null, reviewers: 0, sold: 0, confidence: 'low', total: 0 })).toContain('No reviews yet');
    expect(badgeSvg('NEW', { score: null, reviewers: 1, sold: 0, confidence: 'low', total: 1 })).toContain('1 review · score soon');
    expect(badgeSvg('NEW', { score: null, reviewers: 2, sold: 0, confidence: 'low', total: 2 })).toContain('2 reviews · score soon');
  });
});
