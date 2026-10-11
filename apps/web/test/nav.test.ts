import { describe, expect, it } from 'vitest';
import { backTarget, profileCrumbs } from '../src/data/nav';

describe('deep-page navigation', () => {
  it('"← Back" steps back inside PRISM, and sends visitors from a shared link Home', () => {
    expect(backTarget({ usr: null, key: 'abc', idx: 3 })).toBe(-1); // came from another PRISM page
    expect(backTarget({ usr: null, key: 'default', idx: 0 })).toBe('/'); // landed here from X
    expect(backTarget(null)).toBe('/');
    expect(backTarget(undefined)).toBe('/');
    expect(backTarget({})).toBe('/');
  });

  it('breadcrumbs: Home / @name, every part a link', () => {
    expect(profileCrumbs('@tester', '/u/tester')).toEqual([
      { label: 'Home', to: '/' },
      { label: '@tester', to: '/u/tester' },
    ]);
  });
});
