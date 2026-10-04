import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  encodeErrorResult,
  type Address,
} from 'viem';
import {
  DEPLOYMENTS,
  GAS_RESERVE_WEI,
  blockRanges,
  friendlyError,
  getDeployment,
  localDateTimeToUnix,
  ownedFromTransfers,
  parseTokenAmount,
  planDeposit,
  prismCrystalAbi,
  prismCrystalBytecode,
  revertMessage,
  valueWeights,
} from '../src';

const A = '0x00000000000000000000000000000000000000aa' as Address;
const B = '0x00000000000000000000000000000000000000bb' as Address;
const ME = '0x1111111111111111111111111111111111111111' as Address;
const YOU = '0x2222222222222222222222222222222222222222' as Address;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const E = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

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

describe('planDeposit (pre-flight before anything is sent)', () => {
  const item = (token: Address, amount: bigint, balance: bigint, allowance = 0n) => ({
    token,
    symbol: token === A ? 'NVDA' : 'AAPL',
    amount,
    balance,
    allowance,
  });
  const ethOk = { amount: 0n, balance: E(1) };

  it('passes and lists only the approvals still needed', () => {
    const plan = planDeposit([item(A, E(1), E(5), 0n), item(B, E(2), E(5), E(10))], ethOk);
    expect(plan.ok).toBe(true);
    expect(plan.approvals.map((a) => a.token)).toEqual([A]);
  });

  it('blocks when a token balance is too low', () => {
    const plan = planDeposit([item(A, E(6), E(5))], ethOk);
    expect(plan.ok).toBe(false);
    expect(plan.problems).toContain('Not enough NVDA in your wallet.');
  });

  it('keeps a gas reserve when checking ETH', () => {
    expect(planDeposit([], { amount: E(1), balance: E(1) }).ok).toBe(false);
    expect(planDeposit([], { amount: E(1), balance: E(1) + GAS_RESERVE_WEI }).ok).toBe(true);
    expect(planDeposit([item(A, E(1), E(5))], { amount: 0n, balance: 0n }).problems[0]).toMatch(/gas/);
  });

  it('enforces non-empty, no duplicates and max 8 assets (ETH counts)', () => {
    expect(planDeposit([], ethOk).problems).toContain('Add at least one token amount or some ETH.');
    expect(planDeposit([item(A, E(1), E(5)), item(A, E(1), E(5))], ethOk).problems).toContain('NVDA is listed twice.');
    const plan = planDeposit([item(A, E(1), E(5))], { amount: E(0.1), balance: E(1) }, 8, 7);
    expect(plan.problems.some((p) => p.includes('at most 8'))).toBe(true);
  });
});

describe('friendlyError', () => {
  it('maps wallet rejection', () => {
    const err = new BaseError('outer', { cause: new UserRejectedRequestError(new Error('User rejected the request.')) });
    expect(friendlyError(err)).toBe('You rejected the request in your wallet.');
  });

  it('decodes PrismCrystal custom errors into plain sentences', () => {
    const data = encodeErrorResult({ abi: prismCrystalAbi, errorName: 'CrystalSealed', args: [123n] });
    const revert = new ContractFunctionRevertedError({ abi: prismCrystalAbi, data, functionName: 'withdraw' });
    expect(friendlyError(new BaseError('call failed', { cause: revert }))).toMatch(/sealed/);
    expect(revertMessage('TooManyAssets')).toMatch(/at most 8/);
  });

  it('recognizes insufficient funds and falls back to the short message', () => {
    expect(friendlyError(new BaseError('insufficient funds for gas * price + value'))).toMatch(/Not enough ETH/);
    expect(friendlyError(new BaseError('Something odd'))).toBe('Something odd');
    expect(friendlyError(new Error('boom\nstack'))).toBe('boom');
  });
});

describe('ownedFromTransfers', () => {
  it('replays mints, transfers and burns in chain order', () => {
    const logs = [
      { from: YOU, to: ME, tokenId: 2n, blockNumber: 12n, logIndex: 0 }, // out of order on purpose
      { from: ZERO, to: ME, tokenId: 1n, blockNumber: 10n, logIndex: 0 },
      { from: ZERO, to: YOU, tokenId: 2n, blockNumber: 10n, logIndex: 1 },
      { from: ZERO, to: ME, tokenId: 3n, blockNumber: 11n, logIndex: 0 },
      { from: ME, to: YOU, tokenId: 3n, blockNumber: 11n, logIndex: 5 }, // sold
      { from: ME, to: ZERO, tokenId: 1n, blockNumber: 13n, logIndex: 0 }, // burned
    ];
    expect(ownedFromTransfers(logs, ME)).toEqual([2n]);
    expect(ownedFromTransfers(logs, YOU)).toEqual([3n]);
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

describe('valueWeights', () => {
  it('weights by value and gives unpriced assets an average share', () => {
    expect(valueWeights([1, 3])).toEqual([0.25, 0.75]);
    const w = valueWeights([2, null, 2]);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    expect(w[1]).toBeCloseTo(1 / 3, 12);
    expect(valueWeights([null, null])).toEqual([0.5, 0.5]);
  });

  it('treats a zero value as "none", not as unpriced (ETH-only forge preview)', () => {
    // three tokens picked but left empty, 0.5 ETH entered → ETH is the whole crystal
    expect(valueWeights([0, 0, 0, 0.5])).toEqual([0, 0, 0, 1]);
    // an unpriced holding next to a priced one still gets the average priced share
    expect(valueWeights([0, null, 2])).toEqual([0, 0.5, 0.5]);
    expect(valueWeights([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('deployments + exported contract', () => {
  it('records the testnet deployment (and nothing for other chains)', () => {
    const d = getDeployment(46630)!;
    expect(d).toBe(DEPLOYMENTS[46630]);
    expect(d.prismCrystal).toBe('0x59ce49dE3782FA87E94850b23FEB1457009f9f40');
    expect(d.fromBlock).toBe(128575215n);
    expect(d.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(getDeployment(1)).toBeNull();
  });

  it('exports the PrismCrystal ABI and creation bytecode', () => {
    const names = prismCrystalAbi.filter((x) => x.type === 'function').map((x) => x.name);
    for (const fn of ['forge', 'addTo', 'withdraw', 'withdrawAllAndBurn', 'seal', 'sealedUntil', 'holdings', 'tokenURI']) {
      expect(names).toContain(fn);
    }
    expect(prismCrystalBytecode.startsWith('0x60')).toBe(true);
  });

  it('parses datetime-local values', () => {
    expect(localDateTimeToUnix('')).toBeNull();
    expect(localDateTimeToUnix('2030-01-01T00:00')).toBe(Math.floor(new Date('2030-01-01T00:00').getTime() / 1000));
  });
});
