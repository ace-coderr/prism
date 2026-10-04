import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { PrismForgeRouter } from '../typechain-types';

const E = (n: string | number) => ethers.parseEther(String(n));
const ZERO = ethers.ZeroAddress;

async function deploy() {
  const [alice, bob] = await ethers.getSigners();
  const crystal = await ethers.deployContract('PrismCrystal');
  const pm = await ethers.deployContract('MockPoolManager');
  const mk = (s: string) => ethers.deployContract('MockERC20', [s, s, 18]);
  const aapl = await mk('AAPL');
  const nvda = await mk('NVDA');
  const spcx = await mk('SPCX');
  const unlisted = await mk('USDG');
  const evil = await ethers.deployContract('ReentrantRouterToken');
  // tokens out per 1 ETH in
  for (const [t, r] of [
    [aapl, '9.3'],
    [nvda, '7'],
    [spcx, '5.6'],
    [unlisted, '1'],
    [evil, '2'],
  ] as const) {
    await pm.setRate(await t.getAddress(), E(r));
  }
  const tokens = [aapl, nvda, spcx, evil];
  const router = await ethers.deployContract('PrismForgeRouter', [
    await pm.getAddress(),
    await crystal.getAddress(),
    await Promise.all(tokens.map((t) => t.getAddress())),
    3000,
    60,
  ]);
  const attacker = await ethers.deployContract('RouterAttacker', [await router.getAddress()]);
  return { alice, bob, crystal, pm, aapl, nvda, spcx, unlisted, evil, router, attacker };
}

type Fx = Awaited<ReturnType<typeof deploy>>;
const swap = async (t: { getAddress(): Promise<string> }, eth: string) => ({ token: await t.getAddress(), ethIn: E(eth) });

/** Three stocks + 0.1 ETH kept: 1.1 ETH in total. */
async function basket(f: Fx) {
  const swaps = [await swap(f.aapl, '0.3'), await swap(f.nvda, '0.3'), await swap(f.spcx, '0.4')];
  const expected = [E('2.79'), E('2.1'), E('2.24')]; // 0.3×9.3, 0.3×7, 0.4×5.6
  return { swaps, expected, mins: expected.map((x) => (x * 99n) / 100n), keep: E('0.1') };
}

async function expectRouterEmpty(f: Fx) {
  const r = await f.router.getAddress();
  expect(await ethers.provider.getBalance(r)).to.equal(0n);
  for (const t of [f.aapl, f.nvda, f.spcx, f.evil]) expect(await t.balanceOf(r)).to.equal(0n);
  expect(await f.crystal.balanceOf(r)).to.equal(0n);
}

describe('PrismForgeRouter', () => {
  describe('forgeFromETH', () => {
    it('swaps ETH into each stock and forges a crystal in one transaction', async () => {
      const f = await loadFixture(deploy);
      const b = await basket(f);
      const tokens = b.swaps.map((s) => s.token);
      await expect(f.router.connect(f.alice).forgeFromETH(b.swaps, b.mins, b.keep, { value: E('1.1') }))
        .to.emit(f.router, 'ForgedFromETH')
        .withArgs(1n, f.alice.address, tokens, b.expected, E('1'), b.keep, 0n)
        .and.to.emit(f.crystal, 'Forged');
      expect(await f.crystal.ownerOf(1n)).to.equal(f.alice.address);
      const [held, amounts, eth] = await f.crystal.holdings(1n);
      expect(held).to.deep.equal(tokens);
      expect(amounts).to.deep.equal(b.expected);
      expect(eth).to.equal(b.keep);
      await expectRouterEmpty(f);
    });

    it('works with a single stock and nothing kept as ETH', async () => {
      const f = await loadFixture(deploy);
      await f.router.forgeFromETH([await swap(f.nvda, '0.05')], [1n], 0n, { value: E('0.05') });
      const [, amounts, eth] = await f.crystal.holdings(1n);
      expect(amounts).to.deep.equal([E('0.35')]);
      expect(eth).to.equal(0n);
      await expectRouterEmpty(f);
    });

    it('reverts the whole forge when any swap misses its minimum', async () => {
      const f = await loadFixture(deploy);
      const b = await basket(f);
      const mins = [...b.mins];
      mins[1] = b.expected[1]! + 1n; // NVDA asks for one unit more than the pool gives
      await expect(f.router.forgeFromETH(b.swaps, mins, b.keep, { value: E('1.1') }))
        .to.be.revertedWithCustomError(f.router, 'InsufficientOutput')
        .withArgs(b.swaps[1]!.token, b.expected[1], mins[1]);
      await expect(f.crystal.ownerOf(1n)).to.be.revertedWithCustomError(f.crystal, 'ERC721NonexistentToken');
      await expectRouterEmpty(f);
    });

    it('refunds unspent ETH to the caller', async () => {
      const f = await loadFixture(deploy);
      const b = await basket(f);
      const before = await ethers.provider.getBalance(f.alice.address);
      const tx = await f.router.connect(f.alice).forgeFromETH(b.swaps, b.mins, b.keep, { value: E('2') });
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;
      expect(before - (await ethers.provider.getBalance(f.alice.address))).to.equal(E('1.1') + gas);
      await expect(tx).to.emit(f.router, 'ForgedFromETH').withArgs(1n, f.alice.address, (x: unknown) => true, (x: unknown) => true, E('1'), b.keep, E('0.9'));
      await expectRouterEmpty(f);
    });

    it('refunds ETH a pool did not use (partial fill) when the minimums still hold', async () => {
      const f = await loadFixture(deploy);
      await f.pm.setFillBps(9_000); // pools only take 90%
      const b = await basket(f);
      const mins = b.expected.map((x) => (x * 89n) / 100n);
      const before = await ethers.provider.getBalance(f.alice.address);
      const r = await (await f.router.connect(f.alice).forgeFromETH(b.swaps, mins, b.keep, { value: E('1.1') })).wait();
      const spent = before - (await ethers.provider.getBalance(f.alice.address)) - r!.gasUsed * r!.gasPrice;
      expect(spent).to.equal(E('0.9') + b.keep);
      await expectRouterEmpty(f);
    });

    it('hands any stray token dust to the caller and still ends empty', async () => {
      const f = await loadFixture(deploy);
      await f.aapl.mint(await f.router.getAddress(), 5n); // someone sends tokens to the router
      const b = await basket(f);
      await f.router.connect(f.alice).forgeFromETH(b.swaps, b.mins, b.keep, { value: E('1.1') });
      expect(await f.aapl.balanceOf(f.alice.address)).to.equal(5n);
      await expectRouterEmpty(f);
    });

    it('rejects tokens it was not deployed with', async () => {
      const f = await loadFixture(deploy);
      await expect(f.router.forgeFromETH([await swap(f.unlisted, '0.1')], [1n], 0n, { value: E('0.1') }))
        .to.be.revertedWithCustomError(f.router, 'UnknownToken')
        .withArgs(await f.unlisted.getAddress());
      await expect(f.router.forgeFromETH([{ token: ZERO, ethIn: E('0.1') }], [1n], 0n, { value: E('0.1') }))
        .to.be.revertedWithCustomError(f.router, 'UnknownToken')
        .withArgs(ZERO);
    });

    it('validates its inputs', async () => {
      const f = await loadFixture(deploy);
      const a = await swap(f.aapl, '0.1');
      const v = { value: E('1') };
      await expect(f.router.forgeFromETH([], [], 0n, v)).to.be.revertedWithCustomError(f.router, 'BadSwapCount');
      const six = await Promise.all([f.aapl, f.nvda, f.spcx, f.evil, f.aapl, f.nvda].map((t) => swap(t, '0.01')));
      await expect(f.router.forgeFromETH(six, six.map(() => 1n), 0n, v)).to.be.revertedWithCustomError(f.router, 'BadSwapCount');
      await expect(f.router.forgeFromETH([a], [], 0n, v)).to.be.revertedWithCustomError(f.router, 'LengthMismatch');
      await expect(f.router.forgeFromETH([a, a], [1n, 1n], 0n, v)).to.be.revertedWithCustomError(f.router, 'DuplicateToken');
      await expect(f.router.forgeFromETH([{ ...a, ethIn: 0n }], [1n], 0n, v)).to.be.revertedWithCustomError(f.router, 'ZeroAmount');
      await expect(f.router.forgeFromETH([a], [0n], 0n, v)).to.be.revertedWithCustomError(f.router, 'ZeroMinimum');
      await expect(f.router.forgeFromETH([a], [1n], E('0.5'), { value: E('0.55') }))
        .to.be.revertedWithCustomError(f.router, 'NotEnoughEth')
        .withArgs(E('0.55'), E('0.6'));
    });
  });

  describe('reentrancy and stray calls', () => {
    it('a caller that re-enters when it receives the crystal is stopped', async () => {
      const f = await loadFixture(deploy);
      await f.attacker.arm(1, await f.aapl.getAddress()); // ReenterOnNFT
      // give it ETH of its own, so its inner call really reaches the router
      await ethers.provider.send('hardhat_setBalance', [await f.attacker.getAddress(), '0xDE0B6B3A7640000']);
      const b = await basket(f);
      await expect(f.attacker.forge(b.swaps, b.mins, b.keep, { value: E('1.1') })).to.be.revertedWithCustomError(
        f.router,
        'ReentrancyGuardReentrantCall',
      );
      await expectRouterEmpty(f);
    });

    it('a caller that re-enters on the ETH refund is stopped (the refund fails, so everything reverts)', async () => {
      const f = await loadFixture(deploy);
      await f.attacker.arm(2, await f.aapl.getAddress()); // ReenterOnRefund
      const b = await basket(f);
      await expect(f.attacker.forge(b.swaps, b.mins, b.keep, { value: E('2') })).to.be.revertedWithCustomError(
        f.router,
        'RefundFailed',
      );
      await expectRouterEmpty(f);
    });

    it('a caller that refuses ETH cannot leave ETH stuck in the router', async () => {
      const f = await loadFixture(deploy);
      await f.attacker.arm(3, ZERO); // RejectEth
      const b = await basket(f);
      await expect(f.attacker.forge(b.swaps, b.mins, b.keep, { value: E('2') })).to.be.revertedWithCustomError(f.router, 'RefundFailed');
      // with nothing to refund it works, and the crystal ends with the contract caller
      await f.attacker.forge(b.swaps, b.mins, b.keep, { value: E('1.1') });
      expect(await f.crystal.ownerOf(1n)).to.equal(await f.attacker.getAddress());
      await expectRouterEmpty(f);
    });

    it('a token that re-enters mid-swap is stopped', async () => {
      const f = await loadFixture(deploy);
      await f.evil.arm(await f.router.getAddress());
      await f.alice.sendTransaction({ to: await f.evil.getAddress(), value: E('1') });
      await expect(f.router.forgeFromETH([await swap(f.evil, '0.1')], [1n], 0n, { value: E('0.1') })).to.be.revertedWithCustomError(
        f.router,
        'ReentrancyGuardReentrantCall',
      );
    });

    it('unlockCallback only runs for the PoolManager, during a forge', async () => {
      const f = await loadFixture(deploy);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['tuple(address token,uint256 ethIn)[]'], [[[await f.aapl.getAddress(), 1n]]]);
      await expect(f.router.unlockCallback(data)).to.be.revertedWithCustomError(f.router, 'NotPoolManager');
      await expect(f.pm.poke(await f.router.getAddress(), data)).to.be.revertedWithCustomError(f.router, 'NotForging');
    });

    it('refuses crystals sent to it and plain ETH', async () => {
      const f = await loadFixture(deploy);
      await f.crystal.connect(f.alice).forge([], [], { value: E('0.01') });
      const r = await f.router.getAddress();
      await expect(
        f.crystal.connect(f.alice)['safeTransferFrom(address,address,uint256)'](f.alice.address, r, 1n),
      ).to.be.revertedWithCustomError(f.router, 'UnexpectedNFT');
      await expect(f.alice.sendTransaction({ to: r, value: 1n })).to.be.reverted;
    });
  });

  describe('deployment', () => {
    it('fixes the allowed tokens at deploy', async () => {
      const f = await loadFixture(deploy);
      expect(await f.router.allowedTokens()).to.deep.equal(
        await Promise.all([f.aapl, f.nvda, f.spcx, f.evil].map((t) => t.getAddress())),
      );
      expect(await f.router.isAllowed(await f.nvda.getAddress())).to.equal(true);
      expect(await f.router.isAllowed(await f.unlisted.getAddress())).to.equal(false);
      expect(await f.router.isAllowed(ZERO)).to.equal(false);
      expect(await f.router.FEE()).to.equal(3000n);
      expect(await f.router.TICK_SPACING()).to.equal(60n);
    });

    it('rejects bad constructor arguments', async () => {
      const f = await loadFixture(deploy);
      const F = await ethers.getContractFactory('PrismForgeRouter');
      const pm = await f.pm.getAddress();
      const c = await f.crystal.getAddress();
      const a = await f.aapl.getAddress();
      const n = await f.nvda.getAddress();
      await expect(F.deploy(ZERO, c, [a], 3000, 60)).to.be.revertedWithCustomError(F, 'ZeroAddress');
      await expect(F.deploy(pm, ZERO, [a], 3000, 60)).to.be.revertedWithCustomError(F, 'ZeroAddress');
      await expect(F.deploy(pm, c, [], 3000, 60)).to.be.revertedWithCustomError(F, 'BadTokenList');
      await expect(F.deploy(pm, c, [a, n, a], 3000, 60)).to.be.revertedWithCustomError(F, 'BadTokenList');
      await expect(F.deploy(pm, c, [a, ZERO], 3000, 60)).to.be.revertedWithCustomError(F, 'BadTokenList');
      await expect(F.deploy(pm, c, [a, n, a, n, a, n].map((x, i) => (i < 6 ? ethers.getAddress(`0x${(i + 1).toString(16).padStart(40, '0')}`) : x)), 3000, 60)).to.be.revertedWithCustomError(
        F,
        'BadTokenList',
      );
    });
  });
});

describe('PrismForgeRouter export', () => {
  it('packages/core/src/abi/prismForgeRouter.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(
      readFileSync(path.join(__dirname, '../artifacts/contracts/PrismForgeRouter.sol/PrismForgeRouter.json'), 'utf8'),
    );
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismForgeRouter.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismForgeRouterAbi = ') + 'prismForgeRouterAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismForgeRouterBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});

export type { PrismForgeRouter };
