import { describe, expect, it } from 'vitest';
import { nameProblem } from '../src';

describe('username rules (app side)', () => {
  it('accepts what the contract accepts', () => {
    for (const ok of ['ace', 'abc_123', 'x'.repeat(20)]) expect(nameProblem(ok), ok).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(nameProblem('ab')).toMatch(/At least 3/);
    expect(nameProblem('x'.repeat(21))).toMatch(/At most 20/);
    expect(nameProblem('Ace')).toMatch(/lowercase/);
    expect(nameProblem('a b')).toMatch(/lowercase/);
  });
  it('refuses impersonation-prone words anywhere in the name', () => {
    for (const bad of ['vibevibe', 'the_vibe_vibe', 'prism_team', 'admin1', 'official_ace', 'robinhood_fan']) {
      expect(nameProblem(bad), bad).toMatch(/can’t contain/);
    }
  });
});
