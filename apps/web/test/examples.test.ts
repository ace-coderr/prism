import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { LAUNCH_INDEX_URL, TESTNET_TOKENS, decodeIndex, type ReviewView } from '@prism/core';
import { Feed, CreatorsSellingFeed } from '../src/components/feeds';
import { EXAMPLE_NOTE, ExampleCreatorCard, ExampleReviewCard, ExampleReviewCards, TokenExampleReview } from '../src/components/examples';
import { EXAMPLE_CREATOR_SOLD, EXAMPLE_IDENTITIES, EXAMPLE_REVIEWS, EXAMPLE_XRAY } from '../src/examples/data';

/*
 * Example content fills empty sections so a new visitor doesn't see an empty site. It must never
 * look like real activity or leak into anything that counts or is shared. Each rule is held here.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const at = (p: string) => join(root, p);
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const REAL_CREATOR = { token: '0x1111111111111111111111111111111111111111', symbol: 'REAL', name: 'Real', text: 'The creator had sold 60% of the $REAL they bought.', movedOut: 0.6, launchBlock: 1 } as never;
const REAL_REVIEW = { id: 7 } as ReviewView;

function files(dir: string, ext = /\.(ts|tsx|js|jsx|mjs|json|yml|yaml|html|xml|txt|sol)$/): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', 'artifacts', 'cache', 'typechain-types', '.vercel'].includes(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : [];
  });
}

describe('what an example is', () => {
  const everything = JSON.stringify([EXAMPLE_REVIEWS, EXAMPLE_XRAY, EXAMPLE_CREATOR_SOLD]);

  it('is marked, and has the shape the types promise', () => {
    expect(EXAMPLE_REVIEWS.length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLE_REVIEWS.length).toBeLessThanOrEqual(3);
    for (const x of [...EXAMPLE_REVIEWS, EXAMPLE_XRAY, EXAMPLE_CREATOR_SOLD]) expect(x.isExample).toBe(true);
    // all three states a review can be in
    expect(EXAMPLE_REVIEWS.map((r) => r.state.kind).sort()).toEqual(['holding', 'sold', 'trimmed']);
    // ids that can't be a review number, so nothing builds a /r/<id> link from one
    for (const r of EXAMPLE_REVIEWS) expect(r.id).toMatch(/^example-\d+$/);
    expect(EXAMPLE_XRAY.flag).toBeTruthy();
    expect(EXAMPLE_CREATOR_SOLD.xray).toBe(EXAMPLE_XRAY);
  });

  it('is fictional: no address (not even a placeholder that parses), no link, no handle', () => {
    expect(everything).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(everything).not.toMatch(/https?:|www\.|@\w/i);
    for (const r of EXAMPLE_REVIEWS) expect(r.wallet).toMatch(/^0x0000…000\d$/);
  });

  it('names no real test stock or token PRISM lists', () => {
    const real = new Set(TESTNET_TOKENS.flatMap((t) => [t.id, t.name, t.display?.shortName ?? ''].map((s) => s.toLowerCase().replace(/\W/g, '')).filter(Boolean)));
    for (const { symbol, name } of EXAMPLE_IDENTITIES) {
      expect(real.has(symbol.toLowerCase()), symbol).toBe(false);
      expect(real.has(name.toLowerCase().replace(/\W/g, '')), name).toBe(false);
    }
    expect(new Set(EXAMPLE_IDENTITIES.map((i) => i.symbol)).size).toBe(EXAMPLE_IDENTITIES.length);
  });

  it('matches no launch in the published index, by ticker or by name', async (ctx) => {
    let rows: Array<{ symbol: string; name: string }> | null = null;
    try {
      const local = process.env.LAUNCH_INDEX_FILE;
      const gz = local ? readFileSync(local) : Buffer.from(await (await fetch(LAUNCH_INDEX_URL, { redirect: 'follow', signal: AbortSignal.timeout(90_000) })).arrayBuffer());
      rows = decodeIndex(JSON.parse(gunzipSync(gz).toString('utf8')))?.launches ?? null;
    } catch {
      rows = null;
    }
    if (!rows || rows.length < 1000) return ctx.skip(); // offline: the other tests still hold
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const symbols = new Set(rows.map((l) => norm(l.symbol)));
    const names = new Set(rows.map((l) => norm(l.name)));
    for (const { symbol, name } of EXAMPLE_IDENTITIES) {
      expect(symbols.has(norm(symbol)), `$${symbol} is a real launch's ticker`).toBe(false);
      expect(names.has(norm(name)), `"${name}" is a real launch's name`).toBe(false);
    }
  }, 120_000);
});

describe('what an example looks like', () => {
  const card = html(createElement(ExampleReviewCards));

  it('says EXAMPLE first, as text, with the one-line note, and says it for every card', () => {
    expect(EXAMPLE_NOTE).toBe('Example, not real. Shown until real ones exist.');
    expect(card.split('>EXAMPLE<').length - 1).toBe(EXAMPLE_REVIEWS.length);
    expect(card.split(EXAMPLE_NOTE).length - 1).toBe(EXAMPLE_REVIEWS.length);
    // the tag comes before anything else a card says, so a screen reader and a copy both get it first
    for (const r of EXAMPLE_REVIEWS) {
      const one = html(createElement(ExampleReviewCard, { review: r }));
      expect(one.indexOf('>EXAMPLE<')).toBeGreaterThan(-1);
      expect(one.indexOf('>EXAMPLE<')).toBeLessThan(one.indexOf(r.symbol));
      expect(one.indexOf('>EXAMPLE<')).toBeLessThan(one.indexOf(r.text));
      expect(one).toContain('aria-label="Example, not real"');
    }
    const creator = html(createElement(ExampleCreatorCard));
    expect(creator.indexOf('>EXAMPLE<')).toBeLessThan(creator.indexOf('$EXDIP'));
    expect(creator).toContain(EXAMPLE_NOTE);
  });

  it('is dashed and muted, not styled like a real card', () => {
    for (const h of [card, html(createElement(ExampleCreatorCard))]) {
      expect(h).toContain('border-dashed');
      expect(h).toContain('text-mist');
      expect(h).not.toMatch(/class="[^"]*\bcard\b/); // the real cards' class
    }
  });

  it('links nowhere, loads nothing and can’t be acted on', () => {
    for (const h of [card, html(createElement(ExampleCreatorCard))]) {
      expect(h).not.toMatch(/<a[\s>]|href=|<img|<button|<input|<form|src=/i);
    }
  });

  it('shows what the cards say, not more', () => {
    expect(card).toContain('Holding · 14 days');
    expect(card).toContain('Trimmed 40% · 9 days');
    expect(card).toContain('SOLD after 3 days');
    expect(html(createElement(ExampleCreatorCard))).toContain('◆ Creator sold 80% of their bag');
  });
});

describe('only where a section is empty, and gone the moment it isn’t', () => {
  const EX = '>EXAMPLE<';
  const examples = createElement(ExampleReviewCards);

  it('a feed with no rows shows its real empty text and then the examples', () => {
    const h = html(createElement(Feed, { title: 'Latest reviews', loading: false, empty: 'No reviews yet.', examples }));
    expect(h).toContain('No reviews yet.');
    expect(h).toContain(EX);
    expect(h.indexOf('No reviews yet.')).toBeLessThan(h.indexOf(EX));
  });

  it('one real row removes every example from that feed', () => {
    const h = html(createElement(Feed, { title: 'Latest reviews', loading: false, empty: 'No reviews yet.', examples }, createElement('p', null, 'a real review')));
    expect(h).toContain('a real review');
    expect(h).not.toContain(EX);
    expect(h).not.toContain('EXMOON');
    expect(h).not.toContain(EXAMPLE_NOTE);
  });

  it('nothing shows while a feed is still loading', () => {
    const h = html(createElement(Feed, { title: 'Latest reviews', loading: true, empty: 'No reviews yet.', examples }));
    expect(h).not.toContain(EX);
  });

  it('creators selling: the real empty text plus one example, only once the watch is read and empty', () => {
    const empty = html(createElement(CreatorsSellingFeed, { creators: [], ready: true }));
    expect(empty).toContain('No creator of a recent launch has sold most of what they bought.');
    expect(empty.split(EX).length - 1).toBe(1);
    // not read yet is not empty: no example there
    expect(html(createElement(CreatorsSellingFeed, { creators: [], ready: false }))).not.toContain(EX);
    expect(html(createElement(CreatorsSellingFeed, {}))).not.toContain(EX);
    expect(html(createElement(CreatorsSellingFeed, { creators: [], ready: true, loading: true }))).not.toContain(EX);
    // one real creator and the example is gone, with its note
    const real = html(createElement(CreatorsSellingFeed, { creators: [REAL_CREATOR], ready: true }));
    expect(real).toContain('$REAL');
    expect(real).not.toContain(EX);
    expect(real).not.toContain('EXDIP');
  });

  it('a token page: one example when it has no review at all, none once it has one', () => {
    const none = html(createElement(TokenExampleReview, { reviews: [] }));
    expect(none.split(EX).length - 1).toBe(1);
    expect(html(createElement(TokenExampleReview, { reviews: [REAL_REVIEW] }))).toBe('');
    expect(html(createElement(TokenExampleReview, { reviews: undefined }))).toBe('');
  });
});

describe('where examples are wired, and where they are not', () => {
  const home = readFileSync(at('apps/web/src/pages/Home.tsx'), 'utf8');

  it('Home gives examples to "Latest reviews" and to nothing else of its own', () => {
    expect(home.match(/examples=\{/g)?.length).toBe(1);
    expect(home).toMatch(/<Feed\s+title="Latest reviews"[^>]*examples=\{/s);
    // the real-empty-only boards keep their real empty states
    for (const title of ['Caught selling', 'Top launches by true colors', 'Top honest reviewers']) {
      const tag = home.match(new RegExp(`<Feed[^>]*title="${title}"[^>]*>`, 's'))?.[0];
      expect(tag, title).toBeTruthy();
      expect(tag, title).not.toContain('examples');
    }
  });

  it('leaderboards have none', () => {
    for (const f of ['pages/Leaderboards.tsx', 'pages/Stocks.tsx', 'pages/Profile.tsx', 'pages/ReviewPage.tsx']) {
      expect(existsSync(at(`apps/web/src/${f}`)) ? readFileSync(at(`apps/web/src/${f}`), 'utf8') : '', f).not.toMatch(/examples/i);
    }
  });

  it('only the display code imports them: nothing that counts, scores or fetches can reach them', () => {
    const src = at('apps/web/src');
    const specs = (code: string) => [...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    const importing = (re: RegExp) =>
      files(src)
        .filter((f) => !relative(src, f).startsWith('examples'))
        .filter((f) => specs(readFileSync(f, 'utf8')).some((s) => re.test(s)))
        .map((f) => relative(src, f).replace(/\\/g, '/'))
        .sort();
    // the data: one file, the cards
    expect(importing(/(^|\/)examples\/data$/)).toEqual(['components/examples.tsx']);
    // the cards: the feed shell, Home and the token page, and nothing in data/, the gem, scores, rep or badges
    expect(importing(/(^|\/)(components\/)?examples$/)).toEqual(['components/feeds.tsx', 'pages/Home.tsx', 'pages/Launch.tsx']);
  });

  it('the example module imports no data, wallet or network code', () => {
    for (const f of files(at('apps/web/src/examples'))) {
      const code = readFileSync(f, 'utf8');
      // typeChecks.ts names real types to prove an example isn't one; type imports are erased from the bundle
      const runtime = code.replace(/^import type\b[^;]*;$/gm, '');
      expect(runtime, f).not.toMatch(/from\s*['"](?:\.\.\/data|\.\.\/wallet|wagmi|viem|@tanstack)/);
      expect(code, f).not.toMatch(/\bfetch\s*\(|writeContract|sendTransaction|signMessage/);
    }
    const cards = readFileSync(at('apps/web/src/components/examples.tsx'), 'utf8');
    expect(cards).not.toMatch(/from\s*['"](?:\.\.\/data|\.\.\/wallet|wagmi|@tanstack)|useWallet|useProfile|TokenAvatar|\bLink\b|ShareOnX|\bfetch\s*\(/);
  });
});

describe('nothing that counts or is shared can see an example', () => {
  const names = [...EXAMPLE_IDENTITIES.map((i) => i.symbol), ...EXAMPLE_IDENTITIES.map((i) => i.name), ...EXAMPLE_REVIEWS.map((r) => r.id), EXAMPLE_NOTE, 'EXAMPLE'];
  const roots = [
    'apps/web/server', // every data route, page meta, OG and share images, badges
    'apps/web/scripts',
    'apps/web/public', // static files, any sitemap or robots
    'packages/core/src', // scores, true colors, rep, badges, leaderboards, X-ray, the index and watch formats
    'packages/core/scripts', // what builds the published launch-index, metadata and watch files
    '.github', // the scheduled job and what it publishes
    'contracts/contracts', // on chain
    'contracts/scripts',
  ];

  it('no server route, core code, published-file script, workflow or contract mentions one', () => {
    for (const dir of roots) {
      for (const f of files(at(dir))) {
        const code = readFileSync(f, 'utf8');
        for (const n of names) expect(code, `${relative(root, f)} mentions "${n}"`).not.toContain(n);
        expect(code, relative(root, f)).not.toMatch(/(^|\/)examples\/data['"]|components\/examples['"]/);
      }
    }
  });

  it('the page shell and its share tags carry none', () => {
    const shell = readFileSync(at('apps/web/index.html'), 'utf8');
    for (const n of names) expect(shell).not.toContain(n);
  });

  it('there is no sitemap for one to appear in', () => {
    const all = [...files(at('apps/web/public')), ...files(at('apps/web/server'))].map((f) => relative(root, f).toLowerCase());
    expect(all.filter((f) => /sitemap/.test(f))).toEqual([]);
  });

  it('the real data that drives every count is built without them: the feed, scores and gem take only real records', () => {
    // the feed's counts come from the server's data (never from what the page renders), and the
    // gem, scores and boards are built from it in packages/core, which the test above shows is clean
    const data = readFileSync(at('apps/web/server/data.ts'), 'utf8');
    expect(data).not.toMatch(/example/i);
    const gem = readFileSync(at('apps/web/src/components/Gem.tsx'), 'utf8');
    expect(gem).not.toMatch(/example/i);
  });
});

describe('the section with real data', () => {
  it('is its own thing: "See it on a real launch" has no fallback and says nothing is an example', () => {
    const code = readFileSync(at('apps/web/src/components/RealLaunch.tsx'), 'utf8');
    // hidden unless the X-ray is ready; never reads the examples
    expect(code).toMatch(/if \(!token \|\| !x\) return null/);
    expect(code).not.toMatch(/examples/);
    expect(code).toContain('Nothing on');
    expect(code).toContain('PRISM_TOKEN');
  });
});
