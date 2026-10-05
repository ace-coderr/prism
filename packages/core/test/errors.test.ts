import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseEther, type Abi, type Address, type Hex } from 'viem';
import {
  explainedErrors,
  friendlyError,
  messageForRevertData,
  prismCrystalAbi,
  prismErrorsAbi,
  prismForgeRouterAbi,
  prismProfilesAbi,
  revertDataOf,
  revertMessage,
  tokenById,
} from '../src';

const ANTHROPIC = tokenById('ANTHROPIC')!.address;
const forgeOnly = prismForgeRouterAbi.filter((i) => i.type === 'function' && i.name === 'forgeFromETH');
const revertOf = (abi: Abi, data: Hex) =>
  new BaseError('simulate failed', { cause: new ContractFunctionRevertedError({ abi, data, functionName: 'forgeFromETH' }) });
const insufficient = () =>
  encodeErrorResult({
    abi: prismForgeRouterAbi,
    errorName: 'InsufficientOutput',
    args: [ANTHROPIC, 17_665_250_873_136_203n, 24_079_596_173_837_190n],
  });

describe('contract errors in plain words', () => {
  it('has a sentence for every custom error of PrismCrystal, PrismForgeRouter and PrismProfiles', () => {
    const names = new Set(explainedErrors());
    for (const abi of [prismCrystalAbi, prismForgeRouterAbi, prismProfilesAbi] as Abi[]) {
      for (const item of abi) if (item.type === 'error') expect(names, item.name).toContain(item.name);
    }
    // and none of them falls back to viem's "The contract function … reverted."
    for (const item of prismErrorsAbi()) expect(revertMessage(item.name, [], {})).toBeTruthy();
  });

  it('explains InsufficientOutput (the swap & forge revert) with the token, amounts and slippage', () => {
    const msg = friendlyError(revertOf(prismForgeRouterAbi, insufficient()), { slippageBps: 100 });
    expect(msg).toBe(
      "ANTHROPIC's price moved more than 1% since your quote: you'd get 0.01767 ANTHROPIC, below your minimum of 0.02408. Nothing was swapped. Try again with a fresh quote, or raise slippage.",
    );
    expect(msg).not.toMatch(/reverted/);
    // without the slippage at hand it still reads well
    expect(friendlyError(revertOf(prismForgeRouterAbi, insufficient()))).toMatch(/^ANTHROPIC's price moved more than your slippage/);
  });

  it('decodes the error and its arguments when the call ABI lacks it (writeContract’s one-function ABI)', () => {
    const revert = new ContractFunctionRevertedError({ abi: forgeOnly, data: insufficient(), functionName: 'forgeFromETH' });
    expect(revert.signature).toBeDefined(); // viem alone can't name it
    expect(friendlyError(new BaseError('send failed', { cause: revert }), { slippageBps: 200 })).toMatch(
      /^ANTHROPIC's price moved more than 2% since your quote: you'd get 0\.01767/,
    );
  });

  it('names crystal errors that bubble up through the router', () => {
    const tooMany = encodeErrorResult({ abi: prismCrystalAbi, errorName: 'TooManyAssets' });
    expect(friendlyError(revertOf(prismForgeRouterAbi, tooMany))).toBe('A crystal holds at most 8 assets (ETH counts as one).');
    const receiver = encodeErrorResult({ abi: prismCrystalAbi, errorName: 'ERC721InvalidReceiver', args: ['0x00000000000000000000000000000000000000aa' as Address] });
    expect(friendlyError(revertOf(prismForgeRouterAbi, receiver))).toMatch(/can’t receive crystals/);
  });

  it('fills in the other router errors that carry arguments', () => {
    const data = (errorName: string, args: readonly unknown[]) => encodeErrorResult({ abi: prismForgeRouterAbi, errorName, args } as never);
    expect(friendlyError(revertOf(prismForgeRouterAbi, data('NotEnoughEth', [parseEther('0.01'), parseEther('0.02')])))).toBe(
      'This needs 0.02 ETH, but 0.01 ETH was sent.',
    );
    expect(friendlyError(revertOf(prismForgeRouterAbi, data('UnknownToken', [ANTHROPIC])))).toBe('ANTHROPIC isn’t one of the stocks the router can buy.');
    expect(friendlyError(revertOf(prismForgeRouterAbi, data('ZeroMinimum', [ANTHROPIC])))).toBe('Every swap needs a minimum above zero (ANTHROPIC had none).');
    expect(friendlyError(revertOf(prismForgeRouterAbi, data('DuplicateToken', [ANTHROPIC])))).toBe('ANTHROPIC is listed twice.');
  });

  it('reads revert data out of a raw RPC error (replaying a transaction that failed on-chain)', () => {
    const rpc = Object.assign(new Error('execution reverted'), { data: insufficient() });
    const err = new BaseError('call failed', { cause: rpc });
    expect(revertDataOf(err)).toBe(insufficient());
    expect(messageForRevertData(revertDataOf(err), { slippageBps: 100 })).toMatch(/^ANTHROPIC's price moved more than 1%/);
  });

  it('never shows a bare "reverted" for unknown or empty revert data', () => {
    expect(messageForRevertData('0xdeadbeef')).toBe('The contract refused this (error 0xdeadbeef).');
    expect(messageForRevertData('0x')).toBe('The contract refused this without giving a reason.');
    expect(friendlyError(revertOf(prismForgeRouterAbi, '0x'))).toBe('The contract refused this without giving a reason.');
    const reason = encodeErrorResult({ abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }], errorName: 'Error', args: ['nope'] });
    expect(messageForRevertData(reason)).toBe('The contract refused: nope');
  });
});
