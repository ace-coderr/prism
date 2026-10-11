import { describe, expect, it } from 'vitest';
import { IDENTICON_SIZE, identicon } from '../src';

const A = '0xd5Ed2e8Cf80401e5594f9E18509d46ed88fA9a9e';
const B = '0x7Ed162246748A218E0404542683eeE0FC08fE4bD';

describe('identicon', () => {
  it('is the same for the same address, whatever its case', () => {
    expect(identicon(A)).toEqual(identicon(A.toLowerCase() as typeof A));
  });

  it('differs between addresses', () => {
    expect(identicon(A)).not.toEqual(identicon(B));
  });

  it('is a mirrored 5×5 pattern, never blank or solid, with valid hues', () => {
    for (const addr of [A, B, '0x0000000000000000000000000000000000000001', '0xffffffffffffffffffffffffffffffffffffffff'] as const) {
      const { cells, hue, bgHue } = identicon(addr);
      expect(cells).toHaveLength(IDENTICON_SIZE * IDENTICON_SIZE);
      for (let y = 0; y < IDENTICON_SIZE; y++) {
        const row = cells.slice(y * 5, y * 5 + 5);
        expect(row).toEqual([...row].reverse());
      }
      const filled = cells.filter(Boolean).length;
      expect(filled).toBeGreaterThan(0);
      expect(filled).toBeLessThan(25);
      for (const h of [hue, bgHue]) {
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(360);
      }
      expect(hue).not.toBe(bgHue);
    }
  });
});
