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
      image: 'https://seeprism.vercel.app/api/og/t/0xabc.png',
    });
    expect(out).toContain('<title>$BULO true colors: 4.2 from 12 holders · PRISM</title>');
    expect(out).toContain('<meta property="og:url" content="https://seeprism.vercel.app/t/0xabc" />');
    expect(out).toContain('<meta property="og:image" content="https://seeprism.vercel.app/api/og/t/0xabc.png" />');
    expect(out).toContain('<meta property="og:image:type" content="image/png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://seeprism.vercel.app/api/og/t/0xabc.png" />');
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image" />');
    // escaped, so a review's text can't break out of the attribute
    expect(out).toContain('content="What $BULO (bulo) holders “really” think &amp; more &lt;3"');
    expect(out).not.toContain('prism-crystal');
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
