/**
 * Fork test: "Swap & forge" through the DEPLOYED PrismForgeRouter (0xD134…D24D) on Robinhood
 * Chain Testnet at its latest block (`npm run test:fork`), sent from the wallet that hit the
 * revert (impersonated), with the app's own code for minimums and error messages.
 *
 * The bug: 0.004 ETH into each of AAPL, NVDA, SPCX, ANTHROPIC and OPENAI at 1% slippage
 * reverted with "The contract function "forgeFromETH" reverted." The contract was right: the
 * thin ANTHROPIC pool moved more than 1% between the quote on screen and the send, so the
 * router refused with InsufficientOutput(ANTHROPIC, got, minimum), which the app didn't explain.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect } from 'chai';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { ethers, network } from 'hardhat';
import type { PrismForgeRouter } from '../../typechain-types';

const FORK = process.env.FORK === '1';
const E = (n: string | number) => ethers.parseEther(String(n));

const ROUTER = '0xD1340ad67A4b5C0995CC050bE773ee74293fD24D';
const PRISM_CRYSTAL = '0x59ce49dE3782FA87E94850b23FEB1457009f9f40';
const V4_QUOTER = '0x498928d32bf7649587C4C2D2944038500644c950';
const WALLET = '0x7Ed162246748A218E0404542683eeE0FC08fE4bD'; // the wallet from the bug report
const T = {
  AAPL: '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2',
  NVDA: '0x3ab049897b0697BdA766D8730fe1F955c9c103F0',
  SPCX: '0xba163e9887d54A854323B41fcA9cf64a1c275Ac9',
  ANTHROPIC: '0x92dCe70B18df47ac643Af6377621D74aBE3C868C',
  OPENAI: '0x1b14321750b38f7eD66A363D07a921A668521A5F',
} as const;
const BUG = Object.values(T); // the five, in the order the UI sends them
const EACH = E('0.004');
const SLIPPAGE_BPS = 100;

const quoterAbi = [
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)',
];
const crystalAbi = ['function ownerOf(uint256) view returns (address)', 'function balanceOf(address) view returns (uint256)'];

/** Run a snippet of the app's core (an ES module) in a child process with tsx; it prints JSON. */
function app<T>(code: string): T {
  const tsx = require.resolve('tsx/cli');
  return JSON.parse(execFileSync(process.execPath, [tsx, '--eval', code], { cwd: join(__dirname, '../../..') }).toString());
}
const big = (xs: bigint[]) => `[${xs.map((x) => `${x}n`).join(', ')}]`;

/** The app's minimums at the moment of sending (packages/core forgeFromEth.ts minsAtSend). */
function appMinsAtSend(shown: bigint[], fresh: bigint[]): { ok: true; mins: bigint[] } | { ok: false; moved: number[] } {
  const r = app<{ ok: boolean; mins?: string[]; moved?: number[] }>(`import { minsAtSend } from '@prism/core';
const r = minsAtSend(${big(shown)}, ${big(fresh)}, ${SLIPPAGE_BPS});
process.stdout.write(JSON.stringify(r.ok ? { ok: true, mins: r.mins.map(String) } : { ok: false, moved: r.moved.map((m) => m.index) }));`);
  return r.ok ? { ok: true, mins: r.mins!.map(BigInt) } : { ok: false, moved: r.moved! };
}

/** What the app shows for a forgeFromETH revert, from its raw data, exactly as simulateContract hands it over. */
function appMessage(data: string): string {
  return app<string>(`import { BaseError, ContractFunctionRevertedError } from 'viem';
import { friendlyError, prismForgeRouterAbi } from '@prism/core';
const revert = new ContractFunctionRevertedError({ abi: prismForgeRouterAbi, data: ${JSON.stringify(data)}, functionName: 'forgeFromETH' });
process.stdout.write(JSON.stringify(friendlyError(new BaseError('simulate failed', { cause: revert }), { slippageBps: ${SLIPPAGE_BPS} })));`);
}

/** The app's explanation of a mined transaction that reverted (what steps.tsx shows after replaying it). */
function appRevertData(data: string): string {
  return app<string>(`import { messageForRevertData } from '@prism/core';
process.stdout.write(JSON.stringify(messageForRevertData(${JSON.stringify(data)}, { slippageBps: ${SLIPPAGE_BPS} })));`);
}

/** Revert data from an ethers call / estimate error. */
function revertData(e: unknown): string {
  const err = e as { data?: string; info?: { error?: { data?: string } } };
  const d = err.data ?? err.info?.error?.data;
  if (typeof d !== 'string') throw e;
  return d;
}

(FORK ? describe : describe.skip)('Swap & forge from the bug report, through the deployed router (fork)', function () {
  this.timeout(600_000);

  let router: PrismForgeRouter;
  let wallet: Awaited<ReturnType<typeof ethers.getSigner>>;
  const quoter = () => new ethers.Contract(V4_QUOTER, quoterAbi, ethers.provider);
  const crystal = () => new ethers.Contract(PRISM_CRYSTAL, crystalAbi, ethers.provider);

  async function quote(token: string, ethIn: bigint): Promise<bigint> {
    const [out] = await quoter().quoteExactInputSingle.staticCall({
      poolKey: { currency0: ethers.ZeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress },
      zeroForOne: true,
      exactAmount: ethIn,
      hookData: '0x',
    });
    return out as bigint;
  }
  const quoteAll = (tokens: readonly string[]) => Promise.all(tokens.map((t) => quote(t, EACH)));
  const minsOf = (quotes: bigint[]) => quotes.map((q) => (q * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n);
  const swapsOf = (tokens: readonly string[]) => tokens.map((token) => ({ token, ethIn: EACH }));

  /**
   * Someone else buys `token` (here: through the same router) until a 0.004 ETH quote drops
   * below `below`, doubling the buy each round (pool depth changes from day to day).
   */
  async function someoneBuys(token: string, below: bigint) {
    const [, bot] = await ethers.getSigners();
    for (let i = 0n; i < 10n && (await quote(token, EACH)) >= below; i++) {
      const ethIn = E('0.01') * 2n ** i;
      await (await router.connect(bot!).forgeFromETH([{ token, ethIn }], [1n], 0n, { value: ethIn })).wait();
    }
    expect(await quote(token, EACH)).to.be.lt(below);
  }

  /** The wallet's crystal count, router empty: the usual "it worked" checks. */
  async function expectForged(tx: Promise<{ wait: () => Promise<unknown> }>, before: bigint) {
    const rc = (await (await tx).wait()) as { logs: Array<{ topics: string[]; data: string }> };
    const ev = rc.logs.map((l) => router.interface.parseLog(l)).find((p) => p?.name === 'ForgedFromETH')!;
    expect(await crystal().ownerOf(ev.args.id)).to.equal(WALLET);
    expect(await crystal().balanceOf(WALLET)).to.equal(before + 1n);
    expect(await ethers.provider.getBalance(ROUTER)).to.equal(0n);
    return ev.args.amountsOut as bigint[];
  }

  before(async () => {
    await network.provider.send('evm_mine'); // a local block first: the fork's own block has no known hardfork
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    expect(await ethers.provider.getCode(ROUTER)).to.not.equal('0x');
    router = await ethers.getContractAt('PrismForgeRouter', ROUTER);
    expect([...(await router.allowedTokens())]).to.deep.equal(BUG);
    await network.provider.request({ method: 'hardhat_impersonateAccount', params: [WALLET] });
    await network.provider.send('hardhat_setBalance', [WALLET, '0x56BC75E2D63100000']); // gas on the fork
    wallet = await ethers.getSigner(WALLET);
  });

  it('the exact call works with fresh quotes: 5 stocks × 0.004 ETH, 1% slippage, nothing kept', async () => {
    const quotes = await quoteAll(BUG);
    const mins = minsOf(quotes);
    const before = await crystal().balanceOf(WALLET);
    const out = await expectForged(router.connect(wallet).forgeFromETH(swapsOf(BUG), mins, 0n, { value: EACH * 5n }), before);
    out.forEach((o, i) => expect(o).to.equal(quotes[i])); // same block, same pools: the quote is exact
  });

  it('reproduces the bug: ANTHROPIC moves past 1% after the quote → InsufficientOutput, and the app now says so plainly', async () => {
    const shown = await quoteAll(BUG); // what the UI showed
    const mins = minsOf(shown);
    await someoneBuys(T.ANTHROPIC, mins[3]!);

    const call = router.connect(wallet).forgeFromETH(swapsOf(BUG), mins, 0n, { value: EACH * 5n });
    await expect(call).to.be.revertedWithCustomError(router, 'InsufficientOutput').withArgs(T.ANTHROPIC, anyValue, mins[3]);

    const data = await router
      .connect(wallet)
      .forgeFromETH.staticCall(swapsOf(BUG), mins, 0n, { value: EACH * 5n })
      .then(() => expect.fail('should revert'), revertData);
    const [token, got, minimum] = router.interface.decodeErrorResult('InsufficientOutput', data);
    expect([token, minimum]).to.deep.equal([T.ANTHROPIC, mins[3]]);
    expect(got).to.be.lt(minimum);
    const msg = appMessage(data);
    expect(msg).to.match(/^ANTHROPIC's price moved more than 1% since your quote: you'd get [\d.]+ ANTHROPIC, below your minimum of [\d.]+\. Nothing was swapped\./);
    expect(msg).to.not.match(/reverted/);
    console.log(`      the app now says: ${msg}`);
  });

  it('the fix: the app re-quotes on "Swap & forge", stops before the wallet when a price moved too far, and the next press goes through', async () => {
    const shown = await quoteAll(BUG);
    await someoneBuys(T.ANTHROPIC, minsOf(shown)[3]!);

    // first press: fresh quotes show ANTHROPIC below the minimum on screen → nothing is sent
    const fresh = await quoteAll(BUG);
    const first = appMinsAtSend(minsOf(shown), fresh);
    expect(first).to.deep.equal({ ok: false, moved: [3] });

    // the screen now shows `fresh`; second press: quotes are re-taken and the swap goes through
    const again = await quoteAll(BUG);
    const second = appMinsAtSend(minsOf(fresh), again);
    if (!second.ok) throw new Error('expected the second press to go ahead');
    const before = await crystal().balanceOf(WALLET);
    const out = await expectForged(router.connect(wallet).forgeFromETH(swapsOf(BUG), second.mins, 0n, { value: EACH * 5n }), before);
    out.forEach((o, i) => expect(o).to.be.gte(second.mins[i]!));
  });

  it('a small move within the slippage is not a reason to stop (AAPL ticks up a little)', async () => {
    const shown = await quoteAll(BUG);
    const [, bot] = await ethers.getSigners();
    await (await router.connect(bot!).forgeFromETH([{ token: T.AAPL, ethIn: E('0.002') }], [1n], 0n, { value: E('0.002') })).wait();
    const fresh = await quoteAll(BUG);
    expect(fresh[0]).to.be.lt(shown[0]!); // it did move
    const check = appMinsAtSend(minsOf(shown), fresh);
    if (!check.ok) throw new Error(`stopped for a move inside 1%: ${JSON.stringify(check)}`);
    await expectForged(router.connect(wallet).forgeFromETH(swapsOf(BUG), check.mins, 0n, { value: EACH * 5n }), await crystal().balanceOf(WALLET));
  });

  it('the same bug hits any mix with a thin pool: OPENAI alone, with ETH kept', async () => {
    const [shown] = await quoteAll([T.OPENAI]);
    const [min] = minsOf([shown!]);
    await someoneBuys(T.OPENAI, min!);
    await expect(
      router.connect(wallet).forgeFromETH([{ token: T.OPENAI, ethIn: EACH }], [min!], E('0.001'), { value: EACH + E('0.001') }),
    )
      .to.be.revertedWithCustomError(router, 'InsufficientOutput')
      .withArgs(T.OPENAI, anyValue, min);
    const [fresh] = await quoteAll([T.OPENAI]);
    const check = appMinsAtSend([min!], [fresh!]);
    expect(check.ok).to.equal(false); // the app catches it before the wallet opens
    await expectForged(
      router.connect(wallet).forgeFromETH([{ token: T.OPENAI, ethIn: EACH }], minsOf([fresh!]), E('0.001'), { value: EACH + E('0.001') }),
      await crystal().balanceOf(WALLET),
    );
  });

  it('a price that moves while the wallet is open makes the transaction fail on-chain; replaying it at its block names the reason', async () => {
    const quotes = await quoteAll(BUG);
    const mins = minsOf(quotes);
    const [, bot] = await ethers.getSigners();
    await network.provider.send('evm_setAutomine', [false]);
    try {
      // the bot's buy lands first in the same block, then the user's signed transaction
      const botTx = await router.connect(bot!).forgeFromETH([{ token: T.ANTHROPIC, ethIn: E('0.05') }], [1n], 0n, { value: E('0.05'), gasLimit: 3_000_000 });
      const userTx = await router.connect(wallet).forgeFromETH(swapsOf(BUG), mins, 0n, { value: EACH * 5n, gasLimit: 3_000_000 });
      await network.provider.send('evm_mine');
      expect((await ethers.provider.getTransactionReceipt(botTx.hash))!.status).to.equal(1);
      const rc = (await ethers.provider.getTransactionReceipt(userTx.hash))!;
      expect(rc.status).to.equal(0);

      // what steps.tsx does: replay the same call at the receipt's block and decode the reason
      const data = await ethers.provider
        .call({ from: WALLET, to: ROUTER, data: userTx.data, value: userTx.value, blockTag: rc.blockNumber })
        .then(() => expect.fail('the replay should revert'), revertData);
      expect(router.interface.parseError(data)!.name).to.equal('InsufficientOutput');
      expect(appRevertData(data)).to.match(/^ANTHROPIC's price moved more than 1% since your quote/);
    } finally {
      await network.provider.send('evm_setAutomine', [true]);
    }
  });
});
