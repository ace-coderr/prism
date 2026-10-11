import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, type Abi, type Hex } from 'viem';
import { explainedErrors, formatAmount, friendlyError, messageForRevertData, prismErrorsAbi, prismProfilesAbi, prismReviewsAbi, revertDataOf, revertMessage } from '../src';

const setNameOnly = prismProfilesAbi.filter((i) => i.type === 'function' && i.name === 'setName');
const revertOf = (abi: Abi, data: Hex) =>
  new BaseError('simulate failed', { cause: new ContractFunctionRevertedError({ abi, data, functionName: 'setName' }) });
const taken = () => encodeErrorResult({ abi: prismProfilesAbi, errorName: 'NameTaken', args: ['0x00000000000000000000000000000000000000aa'] });

describe('contract errors in plain words', () => {
  it('has a sentence for every custom error of PrismProfiles and PrismReviews', () => {
    const names = new Set(explainedErrors());
    for (const abi of [prismProfilesAbi, prismReviewsAbi] as Abi[]) for (const item of abi) if (item.type === 'error') expect(names, item.name).toContain(item.name);
    // and none of them falls back to viem's "The contract function … reverted."
    for (const item of prismErrorsAbi()) expect(revertMessage(item.name, [], {})).toBeTruthy();
  });

  it('explains review errors with their arguments and the token', () => {
    const data = (errorName: string, args: readonly unknown[]) => encodeErrorResult({ abi: prismReviewsAbi, errorName, args } as never);
    expect(messageForRevertData(data('NotHolder', ['0x00000000000000000000000000000000000000aa']), { symbol: 'BULO' })).toBe('Only holders can review: you don’t hold any BULO right now.');
    expect(messageForRevertData(data('TextTooLong', [284n]))).toMatch(/this one is 284/);
    expect(messageForRevertData(data('StillHolding', [500n, 1000n]))).toMatch(/at least half/);
    expect(messageForRevertData(data('InvalidRating', [0]))).toBe('Pick a rating from 1 to 5 stars.');
  });

  it('decodes a contract error', () => {
    expect(friendlyError(revertOf(prismProfilesAbi as Abi, taken()))).toBe('Someone else just took that username. Try another.');
  });

  it('decodes the error when the call ABI lacks it (writeContract’s one-function ABI)', () => {
    const revert = new ContractFunctionRevertedError({ abi: setNameOnly, data: taken(), functionName: 'setName' });
    expect(revert.signature).toBeDefined(); // viem alone can't name it
    expect(friendlyError(new BaseError('send failed', { cause: revert }))).toBe('Someone else just took that username. Try another.');
  });

  it('reads revert data out of a raw RPC error (replaying a transaction that failed on-chain)', () => {
    const rpc = Object.assign(new Error('execution reverted'), { data: taken() });
    const err = new BaseError('call failed', { cause: rpc });
    expect(revertDataOf(err)).toBe(taken());
    expect(messageForRevertData(revertDataOf(err))).toMatch(/took that username/);
  });

  it('never shows a bare "reverted" for unknown or empty revert data', () => {
    expect(messageForRevertData('0xdeadbeef')).toBe('The contract refused this (error 0xdeadbeef).');
    expect(messageForRevertData('0x')).toBe('The contract refused this without giving a reason.');
    expect(friendlyError(revertOf(setNameOnly as Abi, '0x'))).toBe('The contract refused this without giving a reason.');
    const reason = encodeErrorResult({ abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }], errorName: 'Error', args: ['nope'] });
    expect(messageForRevertData(reason)).toBe('The contract refused: nope');
  });
});

describe('wallet and RPC errors', () => {
  it('maps wallet rejection', () => {
    const err = new BaseError('outer', { cause: new UserRejectedRequestError(new Error('User rejected the request.')) });
    expect(friendlyError(err)).toBe('You rejected the request in your wallet.');
  });

  it('recognizes insufficient funds and falls back to the short message', () => {
    expect(friendlyError(new BaseError('insufficient funds for gas * price + value'))).toMatch(/Not enough ETH/);
    expect(friendlyError(new BaseError('Something odd'))).toBe('Something odd');
    expect(friendlyError(new Error('boom\nstack'))).toBe('boom');
  });

  it('formats amounts for sentences', () => {
    expect(formatAmount(17_665_250_873_136_203n)).toBe('0.01767');
    expect(formatAmount(0n)).toBe('0');
    expect(formatAmount(12_345_678n, 6)).toBe('12.35');
  });
});
