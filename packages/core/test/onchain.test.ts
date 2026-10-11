import { describe, expect, it } from 'vitest';
import { DEPLOYMENTS, blockRanges, getDeployment, parseTokenAmount, prismProfilesAbi, prismProfilesBytecode } from '../src';

describe('parseTokenAmount', () => {
  it('parses decimals and rejects junk, zero and excess precision', () => {
    expect(parseTokenAmount('1.5', 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseTokenAmount(' 2 ', 6)).toBe(2_000_000n);
    expect(parseTokenAmount('.5', 6)).toBe(500_000n);
    expect(parseTokenAmount('0', 18)).toBeNull();
    expect(parseTokenAmount('', 18)).toBeNull();
    expect(parseTokenAmount('abc', 18)).toBeNull();
    expect(parseTokenAmount('-1', 18)).toBeNull();
    expect(parseTokenAmount('1.0000001', 6)).toBeNull();
  });
});

describe('blockRanges', () => {
  it('splits inclusive ranges under the limit', () => {
    expect(blockRanges(0n, 9n, 4n)).toEqual([
      [0n, 3n],
      [4n, 7n],
      [8n, 9n],
    ]);
    expect(blockRanges(5n, 5n, 100n)).toEqual([[5n, 5n]]);
    expect(blockRanges(10n, 5n, 100n)).toEqual([]);
  });
});

describe('deployments', () => {
  it('records the testnet deployment (and nothing for other chains)', () => {
    const d = getDeployment(46630)!;
    expect(d).toBe(DEPLOYMENTS[46630]);
    expect(d.prismProfiles).toBe('0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300');
    expect(getDeployment(1)).toBeNull();
  });

  it('keeps the crystal app’s contracts, marked legacy', () => {
    const legacy = getDeployment(46630)!.legacy!;
    expect(legacy.prismCrystal).toBe('0x59ce49dE3782FA87E94850b23FEB1457009f9f40');
    expect(legacy.prismCrystalFromBlock).toBe(128575215n);
    expect(legacy.forgeRouter).toBe('0xD1340ad67A4b5C0995CC050bE773ee74293fD24D');
    for (const tx of [legacy.prismCrystalTx, legacy.forgeRouterTx]) expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('exports the PrismProfiles ABI and creation bytecode', () => {
    const names = prismProfilesAbi.filter((x) => x.type === 'function').map((x) => x.name);
    for (const fn of ['profileOf', 'addressOfName', 'setProfile', 'multicall']) expect(names).toContain(fn);
    expect(prismProfilesBytecode.startsWith('0x60')).toBe(true);
  });
});
