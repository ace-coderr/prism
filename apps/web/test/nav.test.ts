import { describe, expect, it } from 'vitest';
import { backTarget, crystalCrumbs, crystalFromHash, crystalHref, profileCrumbs } from '../src/data/nav';

const OWNER = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';
const OTHER = '0x7Ed162246748A218E0404542683eeE0FC08fE4bD';

describe('deep-page navigation', () => {
  it('"← Back" steps back inside PRISM, and sends visitors from a shared link to the Gallery', () => {
    expect(backTarget({ usr: null, key: 'abc', idx: 3 })).toBe(-1); // came from another PRISM page
    expect(backTarget({ usr: null, key: 'default', idx: 0 })).toBe('/gallery'); // landed here from X
    expect(backTarget(null)).toBe('/gallery');
    expect(backTarget(undefined)).toBe('/gallery');
    expect(backTarget({})).toBe('/gallery');
  });

  it('"View crystal #id" opens your own crystal in My Crystals, anyone else’s card in the Gallery', () => {
    expect(crystalHref(2n, OWNER, OWNER.toLowerCase() as `0x${string}`)).toBe('/my-crystals?id=2');
    expect(crystalHref(2n, OWNER, OTHER)).toBe('/gallery#crystal-2');
    expect(crystalHref(2n, OWNER, undefined)).toBe('/gallery#crystal-2');
    expect(crystalHref(2n, undefined, OTHER)).toBe('/gallery#crystal-2');
  });

  it('the Gallery finds the crystal a link points at', () => {
    expect(crystalFromHash('#crystal-2')).toBe(2n);
    expect(crystalFromHash('#crystal-')).toBeNull();
    expect(crystalFromHash('#badges')).toBeNull();
    expect(crystalFromHash('')).toBeNull();
  });

  it('breadcrumbs: Gallery / Crystal #2 / Replay (or Gift), and Gallery / @name, every part a link', () => {
    expect(crystalCrumbs(2n, 'Replay', '/gallery#crystal-2')).toEqual([
      { label: 'Gallery', to: '/gallery' },
      { label: 'Crystal #2', to: '/gallery#crystal-2' },
      { label: 'Replay', to: '/replay/2' },
    ]);
    expect(crystalCrumbs(7n, 'Gift', '/my-crystals?id=7').map((c) => `${c.label} → ${c.to}`)).toEqual([
      'Gallery → /gallery',
      'Crystal #7 → /my-crystals?id=7',
      'Gift → /gift/7',
    ]);
    expect(crystalCrumbs(null, 'Replay', '/gallery').map((c) => c.label)).toEqual(['Gallery', 'Replay']);
    expect(profileCrumbs('@tester', '/u/tester')).toEqual([
      { label: 'Gallery', to: '/gallery' },
      { label: '@tester', to: '/u/tester' },
    ]);
  });
});
