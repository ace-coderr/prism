import { describe, expect, it } from 'vitest';
import {
  ASSET_SHADES,
  SHADE_COUNT,
  SHADE_STEP,
  buildCrystal,
  colorDistance,
  hexToOklch,
  holdingShade,
  holdingShades,
  preferredShade,
  shadeSlots,
  type Holding,
} from '../src';

const MOVES = [0.01, 0.4, 1, 2.5, 5, 8, 30];
const h = (symbol: string, change24h: number, weight = 1): Holding => ({ symbol, weight, change24h, volatility: 0.4 });
const clusterOf = (holdings: Holding[], symbol: string) => buildCrystal(holdings).clusters.find((c) => c.symbol === symbol)!;

describe('per-asset shades', () => {
  it('each asset keeps the same shade in every crystal', () => {
    const crystals = [
      [h('AAPL', 3), h('NVDA', 2), h('SPCX', 1)],
      [h('SPCX', 9), h('AAPL', 3, 4)],
      [h('ETH', -1), h('ANTHROPIC', 2), h('AAPL', 3), h('OPENAI', 0.5), h('NVDA', 7)],
      [h('AAPL', 3), h('MYSTERY', 1), h('ZZZ', 1), h('WETH', 2), h('USDG', 0)],
    ];
    expect(new Set(crystals.map((c) => clusterOf(c, 'AAPL').color)).size).toBe(1);
    for (const c of crystals) {
      for (const cl of buildCrystal(c).clusters) {
        if (cl.symbol in ASSET_SHADES) expect(cl.shade).toBe(ASSET_SHADES[cl.symbol]);
      }
    }
    // flipping from up to down keeps the asset's slot, and so its lightness
    const up = clusterOf([h('NVDA', 4), h('AAPL', 1)], 'NVDA');
    const down = clusterOf([h('AAPL', 1), h('NVDA', -4)], 'NVDA');
    expect(down.shade).toBe(up.shade);
    expect(Math.abs(hexToOklch(up.color).L - hexToOklch(down.color).L)).toBeLessThan(0.01);
  });

  it('every known asset has its own slot; ETH and WETH share one', () => {
    const slots = Object.values(ASSET_SHADES);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.every((s) => s >= 0 && s < SHADE_COUNT)).toBe(true);
    expect(preferredShade('WETH')).toBe(preferredShade('ETH'));
    // an unknown symbol always asks for the same slot
    expect(preferredShade('MYSTERY')).toBe(preferredShade('MYSTERY'));
  });

  it('never repeats a shade inside one crystal (up to SHADE_COUNT holdings)', () => {
    const symbols = ['ETH', 'WETH', 'AAPL', 'TOKEN_A', 'TOKEN_B', 'TOKEN_C', 'NVDA', 'SPCX'];
    const slots = shadeSlots(symbols);
    expect(new Set(slots).size).toBe(symbols.length);
    // the real asset keeps its slot, the alias moves
    expect(slots[0]).toBe(ASSET_SHADES.ETH);
    expect(slots[2]).toBe(ASSET_SHADES.AAPL);
    // the order of the holdings doesn't change who gets which shade
    expect(shadeSlots([...symbols].reverse()).reverse()).toEqual(slots);
  });

  it('shades within a family are clearly apart, whatever the size of each move', () => {
    for (const sign of [1, -1, Number.NaN]) {
      for (const boost of [false, true]) {
        for (let i = 0; i < SHADE_COUNT; i++) {
          for (let j = i + 1; j < SHADE_COUNT; j++) {
            for (const mi of MOVES) {
              for (const mj of MOVES) {
                const a = holdingShade(i, sign * mi, { boost }).color;
                const b = holdingShade(j, sign * mj, { boost }).color;
                // OKLab ΔE: 0.02 is barely visible; neighbouring lightness levels sit ~0.07 apart
                expect(colorDistance(a, b), `${sign} ${boost} ${i}@${mi} vs ${j}@${mj}`).toBeGreaterThan(0.06);
              }
            }
          }
        }
      }
    }
    expect(SHADE_STEP).toBeGreaterThan(0.06);
  });

  it('keeps the live basket (six assets) especially far apart', () => {
    const basket = ['AAPL', 'NVDA', 'SPCX', 'ANTHROPIC', 'OPENAI', 'WETH'];
    for (const move of [0.01, 1.5, 8, -0.01, -1.5, -8]) {
      const cs = holdingShades(basket.map((s) => h(s, move))).map((x) => x.color);
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) expect(colorDistance(cs[i]!, cs[j]!)).toBeGreaterThan(0.08);
    }
  });

  it('green and red families never cross', () => {
    let closest = Infinity;
    for (let i = 0; i < SHADE_COUNT; i++) {
      for (const m of MOVES) {
        for (const boost of [false, true]) {
          const up = holdingShade(i, m, { boost });
          const down = holdingShade(i, -m, { boost });
          expect(up.family).toBe('up');
          expect(down.family).toBe('down');
          const g = hexToOklch(up.color);
          const r = hexToOklch(down.color);
          // greens stay between yellow-green and teal; reds between pink-red and orange-red
          expect(g.h).toBeGreaterThan(110);
          expect(g.h).toBeLessThan(200);
          expect(r.h < 50 || r.h > 340).toBe(true);
          // and both keep enough colour to read as green / red, not grey
          expect(g.C).toBeGreaterThan(0.055);
          expect(r.C).toBeGreaterThan(0.055);
          for (let j = 0; j < SHADE_COUNT; j++) {
            for (const m2 of MOVES) closest = Math.min(closest, colorDistance(up.color, holdingShade(j, -m2, { boost }).color));
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(0.09);
    // 0% counts as up; only a missing price is grey
    expect(holdingShade(0, 0).family).toBe('up');
    expect(holdingShade(0, Number.NaN).family).toBe('none');
  });

  it('greys (no price) are per-asset too', () => {
    const greys = Array.from({ length: SHADE_COUNT }, (_, i) => holdingShade(i, Number.NaN).color);
    expect(new Set(greys).size).toBe(SHADE_COUNT);
    for (const g of greys) expect(hexToOklch(g).C).toBeLessThan(0.02);
  });
});
