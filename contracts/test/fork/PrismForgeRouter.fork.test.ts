/**
 * Fork tests: Robinhood Chain Testnet at its latest block (`npm run test:fork`).
 * The router is deployed on the fork and swaps through the REAL Uniswap V4 pools into
 * the REAL PrismCrystal (0x59ce…9f40). Quotes come from the real V4Quoter.
 * Addresses: packages/core/src/tokens.ts (tokens), pool.ts (PoolManager) and vibe/vibe's
 * published config for chain 46630 (V4Quoter).
 */
import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { PrismForgeRouter } from '../../typechain-types';

const FORK = process.env.FORK === '1';
const E = (n: string | number) => ethers.parseEther(String(n));

const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V4_QUOTER = '0x498928d32bf7649587C4C2D2944038500644c950';
const PRISM_CRYSTAL = '0x59ce49dE3782FA87E94850b23FEB1457009f9f40';
const T = {
  AAPL: '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2',
  NVDA: '0x3ab049897b0697BdA766D8730fe1F955c9c103F0',
  SPCX: '0xba163e9887d54A854323B41fcA9cf64a1c275Ac9',
  ANTHROPIC: '0x92dCe70B18df47ac643Af6377621D74aBE3C868C',
  OPENAI: '0x1b14321750b38f7eD66A363D07a921A668521A5F',
} as const;
const USDG = '0x102154E70D8485Ff466bab229bE90a763bF33264'; // has an ETH pool, but isn't a test stock

const quoterAbi = [
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)',
];
const crystalAbi = [
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function holdings(uint256) view returns (address[] tokens, uint256[] balances, uint256 eth)',
];

(FORK ? describe : describe.skip)('PrismForgeRouter on a fork of Robinhood Chain Testnet', function () {
  this.timeout(600_000);

  let router: PrismForgeRouter;
  let routerAddr: string;
  const quoter = () => new ethers.Contract(V4_QUOTER, quoterAbi, ethers.provider);
  const crystal = () => new ethers.Contract(PRISM_CRYSTAL, crystalAbi, ethers.provider);
  const erc20 = (a: string) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)'], ethers.provider);

  async function quote(token: string, ethIn: bigint): Promise<bigint> {
    const [out] = await quoter().quoteExactInputSingle.staticCall({
      poolKey: { currency0: ethers.ZeroAddress, currency1: token, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress },
      zeroForOne: true,
      exactAmount: ethIn,
      hookData: '0x',
    });
    return out as bigint;
  }

  async function expectRouterEmpty() {
    expect(await ethers.provider.getBalance(routerAddr)).to.equal(0n);
    for (const a of Object.values(T)) expect(await erc20(a).balanceOf(routerAddr)).to.equal(0n);
    expect(await crystal().balanceOf(routerAddr)).to.equal(0n);
  }

  before(async () => {
    const net = await ethers.provider.getNetwork();
    expect(net.chainId).to.equal(46630n);
    expect(await ethers.provider.getCode(PRISM_CRYSTAL)).to.not.equal('0x');
    router = await ethers.deployContract('PrismForgeRouter', [POOL_MANAGER, PRISM_CRYSTAL, Object.values(T), 3000, 60]);
    routerAddr = await router.getAddress();
  });

  it('swaps through the real pools and forges a real crystal (3 stocks + ETH kept), NFT to the caller', async () => {
    const [me] = await ethers.getSigners();
    const each = E('0.01');
    const tokens = [T.AAPL, T.NVDA, T.SPCX];
    const quotes = await Promise.all(tokens.map((t) => quote(t, each)));
    const mins = quotes.map((q) => (q * 99n) / 100n); // 1% slippage
    const swaps = tokens.map((token) => ({ token, ethIn: each }));
    const keep = E('0.005');

    const tx = await router.connect(me).forgeFromETH(swaps, mins, keep, { value: E('0.035') });
    const rc = (await tx.wait())!;
    const ev = rc.logs.map((l) => router.interface.parseLog(l)).find((p) => p?.name === 'ForgedFromETH')!;
    const id = ev.args.id as bigint;
    const amountsOut = ev.args.amountsOut as bigint[];

    expect(await crystal().ownerOf(id)).to.equal(me!.address);
    const [held, balances, eth] = await crystal().holdings(id);
    expect([...held]).to.deep.equal(tokens);
    expect([...balances]).to.deep.equal(amountsOut);
    expect(eth).to.equal(keep);
    amountsOut.forEach((out, i) => expect(out).to.be.gte(mins[i]!));
    // the quoter and the real swap agree (same block, same pool state)
    amountsOut.forEach((out, i) => expect(out).to.equal(quotes[i]));
    await expectRouterEmpty();

    console.log(`      gas: forgeFromETH with 3 stocks + ETH kept = ${rc.gasUsed} (L2 execution gas)`);
    console.log(`      got: ${amountsOut.map((a, i) => `${ethers.formatUnits(a, 18)} ${['AAPL', 'NVDA', 'SPCX'][i]}`).join(', ')}`);
  });

  it('reverts entirely when a swap misses its minimum (slippage)', async () => {
    const [, me] = await ethers.getSigners();
    const q = await quote(T.NVDA, E('0.02'));
    const before = await ethers.provider.getBalance(me!.address);
    await expect(
      router.connect(me!).forgeFromETH([{ token: T.NVDA, ethIn: E('0.02') }], [(q * 102n) / 100n], 0n, { value: E('0.02') }),
    ).to.be.revertedWithCustomError(router, 'InsufficientOutput');
    expect(before - (await ethers.provider.getBalance(me!.address))).to.be.lt(E('0.001')); // only gas
    await expectRouterEmpty();
  });

  it('refunds leftover ETH to the caller', async () => {
    const [, , me] = await ethers.getSigners();
    const q = await quote(T.AAPL, E('0.01'));
    const before = await ethers.provider.getBalance(me!.address);
    const rc = (await (await router.connect(me!).forgeFromETH([{ token: T.AAPL, ethIn: E('0.01') }], [(q * 99n) / 100n], 0n, { value: E('0.5') })).wait())!;
    const spent = before - (await ethers.provider.getBalance(me!.address)) - rc.gasUsed * rc.gasPrice;
    expect(spent).to.equal(E('0.01'));
    await expectRouterEmpty();
  });

  it('swaps into all five test stocks, including the thin OPENAI and ANTHROPIC pools', async () => {
    const [, , , me] = await ethers.getSigners();
    const tokens = Object.values(T);
    const each = E('0.005');
    const quotes = await Promise.all(tokens.map((t) => quote(t, each)));
    const tx = await router.connect(me!).forgeFromETH(
      tokens.map((token) => ({ token, ethIn: each })),
      quotes.map((q) => (q * 99n) / 100n),
      0n,
      { value: each * 5n },
    );
    const rc = (await tx.wait())!;
    const ev = rc.logs.map((l) => router.interface.parseLog(l)).find((p) => p?.name === 'ForgedFromETH')!;
    expect(await crystal().ownerOf(ev.args.id)).to.equal(me!.address);
    await expectRouterEmpty();
    console.log(`      gas: forgeFromETH with all 5 stocks = ${rc.gasUsed}`);
  });

  it('rejects a real token it was not deployed with (USDG)', async () => {
    await expect(router.forgeFromETH([{ token: USDG, ethIn: E('0.01') }], [1n], 0n, { value: E('0.01') }))
      .to.be.revertedWithCustomError(router, 'UnknownToken')
      .withArgs(USDG);
  });

  it('stops a caller that re-enters when it receives the crystal', async () => {
    const attacker = await ethers.deployContract('RouterAttacker', [routerAddr]);
    await attacker.arm(1, T.AAPL);
    await ethers.provider.send('hardhat_setBalance', [await attacker.getAddress(), '0xDE0B6B3A7640000']);
    const q = await quote(T.AAPL, E('0.01'));
    await expect(attacker.forge([{ token: T.AAPL, ethIn: E('0.01') }], [(q * 99n) / 100n], 0n, { value: E('0.01') })).to.be.revertedWithCustomError(
      router,
      'ReentrancyGuardReentrantCall',
    );
    await expectRouterEmpty();
  });
});
