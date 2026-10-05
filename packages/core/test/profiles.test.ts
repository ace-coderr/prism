import { describe, expect, it } from 'vitest';
import { bioBytes, bioProblem, blockedWord, nameProblem, normalizeX, xProblem } from '../src';

describe('username rules (app side)', () => {
  it('accepts what the contract accepts', () => {
    for (const ok of ['ace', 'abc_123', 'x'.repeat(20), 'grape_juice', 'class_act', 'cocktail_hour']) expect(nameProblem(ok), ok).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(nameProblem('ab')).toMatch(/At least 3/);
    expect(nameProblem('x'.repeat(21))).toMatch(/At most 20/);
    expect(nameProblem('Ace')).toMatch(/lowercase/);
    expect(nameProblem('a b')).toMatch(/lowercase/);
  });
  it('refuses impersonation-prone words anywhere, even split by _', () => {
    for (const bad of ['vibevibe', 'the_vibe_vibe', 'prism_team', 'pr_ism', 'admin1', 'official_ace', 'robinhood_fan', 'robin_hood']) {
      expect(nameProblem(bad), bad).toMatch(/can’t contain/);
    }
  });
  it('refuses basic profanity without catching innocent words', () => {
    for (const bad of ['fuck_it', 'shithead', 'big_ass', 'ass_99']) expect(nameProblem(bad), bad).toMatch(/can’t contain that word/);
    for (const ok of ['assassin', 'classic', 'grapefruit', 'dickens_fan', 'this_hit']) expect(nameProblem(ok), ok).toBeNull();
  });
});

describe('bio rules', () => {
  it('counts UTF-8 bytes like the contract (max 120)', () => {
    expect(bioBytes('abc')).toBe(3);
    expect(bioBytes('é')).toBe(2);
    expect(bioBytes('💎')).toBe(4);
    expect(bioProblem('x'.repeat(120))).toBeNull();
    expect(bioProblem('x'.repeat(121))).toMatch(/120 bytes/);
    expect(bioProblem('💎'.repeat(31))).toMatch(/120 bytes/);
  });
  it('allows empty (no bio), refuses line breaks and blocked words', () => {
    expect(bioProblem('')).toBeNull();
    expect(bioProblem('Long-term holder of shiny things.')).toBeNull();
    expect(bioProblem('Collecting PRISM crystals since day one.')).toBeNull(); // "prism" is fine in a bio
    expect(nameProblem('prism_collector')).toMatch(/can’t contain/); // but not in a username
    expect(bioProblem('two\nlines')).toMatch(/line breaks/);
    expect(bioProblem('Official Robinhood support')).toMatch(/can’t contain/);
    expect(bioProblem('the vibe/vibe team')).toMatch(/can’t contain/);
    expect(bioProblem('what the fuck')).toMatch(/can’t contain that word/);
  });
});

describe('X handle rules', () => {
  it('normalizes what people paste', () => {
    expect(normalizeX(' @_ace_won ')).toBe('_ace_won');
    expect(normalizeX('https://x.com/_ace_won')).toBe('_ace_won');
    expect(normalizeX('twitter.com/ace')).toBe('ace');
  });
  it('accepts 1–15 of A–Z a–z 0–9 _, empty = none', () => {
    for (const ok of ['', 'a', '_ace_won', 'Ace_Won1', 'x'.repeat(15)]) expect(xProblem(ok), ok).toBeNull();
    expect(xProblem('x'.repeat(16))).toMatch(/At most 15/);
    expect(xProblem('a-b')).toMatch(/Only letters/);
    expect(xProblem('x.com/ace')).toMatch(/Only letters/);
  });
});

describe('blockedWord', () => {
  it('ignores case and separators for reserved words', () => {
    expect(blockedWord('PRISM')).toBe('prism');
    expect(blockedWord('Vibe Vibe')).toMatch(/^vibe_?vibe$/);
    expect(blockedWord('hello there')).toBeNull();
  });
});
