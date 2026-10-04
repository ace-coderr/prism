import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { PrismCrystal, MockERC20 } from '../typechain-types';

const E = (n: string | number) => ethers.parseEther(String(n));
const ZERO = ethers.ZeroAddress;

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const crystal = await ethers.deployContract('PrismCrystal');
  const addr = await crystal.getAddress();

  const mk = async (sym: string, dec = 18) => {
    const t = await ethers.deployContract('MockERC20', [sym, sym, dec]);
    for (const s of [alice, bob, carol]) {
      await t.mint(s.address, E(1_000_000));
      await t.connect(s).approve(addr, ethers.MaxUint256);
    }
    return t;
  };
  const nvda = await mk('NVDA');
  const aapl = await mk('AAPL');
  const usdg = await mk('USDG', 6);

  const fee = await ethers.deployContract('FeeOnTransferToken', [100]); // 1%
  await fee.mint(alice.address, E(1000));
  await fee.connect(alice).approve(addr, ethers.MaxUint256);

  return { crystal, addr, alice, bob, carol, nvda, aapl, usdg, fee, mk };
}

/** Forge and return the new id (ids are sequential from 1). */
async function forge(
  crystal: PrismCrystal,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  tokens: string[],
  amounts: bigint[],
  value = 0n,
) {
  const id = await crystal.connect(signer).forge.staticCall(tokens, amounts, { value });
  await crystal.connect(signer).forge(tokens, amounts, { value });
  return id;
}

describe('PrismCrystal', () => {
  describe('forge / addTo / withdraw', () => {
    it('forges a crystal holding tokens + ETH and mints it to the sender', async () => {
      const { crystal, addr, alice, nvda, aapl } = await loadFixture(deploy);
      const tx = crystal.connect(alice).forge([await nvda.getAddress(), await aapl.getAddress()], [E(10), E(5)], {
        value: E(1),
      });
      await expect(tx)
        .to.emit(crystal, 'Forged')
        .withArgs(1n, alice.address, [await nvda.getAddress(), await aapl.getAddress()], [E(10), E(5)], E(1));
      expect(await crystal.ownerOf(1)).to.equal(alice.address);
      const [tokens, balances, eth] = await crystal.holdings(1);
      expect(tokens).to.deep.equal([await nvda.getAddress(), await aapl.getAddress()]);
      expect(balances).to.deep.equal([E(10), E(5)]);
      expect(eth).to.equal(E(1));
      expect(await nvda.balanceOf(addr)).to.equal(E(10));
      expect(await ethers.provider.getBalance(addr)).to.equal(E(1));
    });

    it('can forge with ETH only, or tokens only', async () => {
      const { crystal, alice, nvda } = await loadFixture(deploy);
      await forge(crystal, alice, [], [], E(0.5));
      await forge(crystal, alice, [await nvda.getAddress()], [E(1)]);
      expect((await crystal.holdings(1))[2]).to.equal(E(0.5));
      expect((await crystal.holdings(2))[1]).to.deep.equal([E(1)]);
    });

    it('addTo tops up existing assets and adds new ones', async () => {
      const { crystal, alice, nvda, aapl } = await loadFixture(deploy);
      const id = await forge(crystal, alice, [await nvda.getAddress()], [E(10)]);
      await expect(
        crystal.connect(alice).addTo(id, [await nvda.getAddress(), await aapl.getAddress()], [E(2), E(3)], { value: E(2) }),
      ).to.emit(crystal, 'Added');
      const [tokens, balances, eth] = await crystal.holdings(id);
      expect(tokens).to.deep.equal([await nvda.getAddress(), await aapl.getAddress()]);
      expect(balances).to.deep.equal([E(12), E(3)]);
      expect(eth).to.equal(E(2));
    });

    it('withdraws part of the tokens and ETH to any address', async () => {
      const { crystal, alice, carol, nvda, aapl } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const a = await aapl.getAddress();
      const id = await forge(crystal, alice, [n, a], [E(10), E(5)], E(1));
      const before = await ethers.provider.getBalance(carol.address);
      await expect(crystal.connect(alice).withdraw(id, [n], [E(4)], E(0.25), carol.address))
        .to.emit(crystal, 'Withdrawn')
        .withArgs(id, carol.address, [n], [E(4)], E(0.25));
      expect(await nvda.balanceOf(carol.address)).to.equal(E(1_000_004));
      expect((await ethers.provider.getBalance(carol.address)) - before).to.equal(E(0.25));
      const [tokens, balances, eth] = await crystal.holdings(id);
      expect(tokens).to.deep.equal([n, a]);
      expect(balances).to.deep.equal([E(6), E(5)]);
      expect(eth).to.equal(E(0.75));
    });

    it('withdrawing a full balance frees the asset slot', async () => {
      const { crystal, alice, nvda, aapl } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const a = await aapl.getAddress();
      const id = await forge(crystal, alice, [n, a], [E(10), E(5)]);
      await crystal.connect(alice).withdraw(id, [n], [E(10)], 0, alice.address);
      const [tokens, balances] = await crystal.holdings(id);
      expect(tokens).to.deep.equal([a]);
      expect(balances).to.deep.equal([E(5)]);
    });

    it('rejects over-withdrawal and empty withdrawals', async () => {
      const { crystal, alice, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(1)], E(1));
      await expect(crystal.connect(alice).withdraw(id, [n], [E(2)], 0, alice.address)).to.be.revertedWithCustomError(
        crystal,
        'InsufficientBalance',
      );
      await expect(crystal.connect(alice).withdraw(id, [], [], E(2), alice.address)).to.be.revertedWithCustomError(
        crystal,
        'InsufficientEth',
      );
      await expect(crystal.connect(alice).withdraw(id, [], [], 0, alice.address)).to.be.revertedWithCustomError(
        crystal,
        'NothingToWithdraw',
      );
      await expect(crystal.connect(alice).withdraw(id, [n], [E(1)], 0, ZERO)).to.be.revertedWithCustomError(
        crystal,
        'ZeroAddress',
      );
    });

    it('rejects plain ETH sent to the contract (no receive function)', async () => {
      const { addr, alice } = await loadFixture(deploy);
      await expect(alice.sendTransaction({ to: addr, value: E(1) })).to.be.reverted;
    });
  });

  describe('ownership and access', () => {
    it('only the owner can addTo, withdraw, burn or seal', async () => {
      const { crystal, alice, bob, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(10)], E(1));
      const asBob = crystal.connect(bob);
      await expect(asBob.addTo(id, [n], [E(1)])).to.be.revertedWithCustomError(crystal, 'NotCrystalOwner');
      await expect(asBob.withdraw(id, [n], [E(1)], 0, bob.address)).to.be.revertedWithCustomError(
        crystal,
        'NotCrystalOwner',
      );
      await expect(asBob.withdrawAllAndBurn(id, bob.address)).to.be.revertedWithCustomError(crystal, 'NotCrystalOwner');
      await expect(asBob.seal(id, (await time.latest()) + 100)).to.be.revertedWithCustomError(
        crystal,
        'NotCrystalOwner',
      );
    });

    it('an approved operator can move the NFT but never its contents', async () => {
      const { crystal, alice, bob, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(10)]);
      await crystal.connect(alice).setApprovalForAll(bob.address, true);
      await expect(crystal.connect(bob).withdraw(id, [n], [E(1)], 0, bob.address)).to.be.revertedWithCustomError(
        crystal,
        'NotCrystalOwner',
      );
    });

    it('transferring the NFT transfers the basket: old owner loses access, new owner gains it', async () => {
      const { crystal, alice, bob, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(10)], E(1));
      await crystal.connect(alice).transferFrom(alice.address, bob.address, id);

      await expect(crystal.connect(alice).withdraw(id, [n], [E(1)], 0, alice.address)).to.be.revertedWithCustomError(
        crystal,
        'NotCrystalOwner',
      );
      await expect(crystal.connect(alice).addTo(id, [n], [E(1)])).to.be.revertedWithCustomError(
        crystal,
        'NotCrystalOwner',
      );

      await crystal.connect(bob).withdraw(id, [n], [E(10)], E(1), bob.address);
      expect(await nvda.balanceOf(bob.address)).to.equal(E(1_000_010));
      await crystal.connect(bob).addTo(id, [n], [E(2)]);
      expect((await crystal.holdings(id))[1]).to.deep.equal([E(2)]);
    });
  });

  describe('sealed gifts', () => {
    it('blocks withdrawals until unlockTime, then allows them', async () => {
      const { crystal, alice, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(10)], E(1));
      const unlock = (await time.latest()) + 3600;
      await expect(crystal.connect(alice).seal(id, unlock)).to.emit(crystal, 'Sealed').withArgs(id, unlock);
      expect(await crystal.sealedUntil(id)).to.equal(unlock);
      expect(await crystal.isSealed(id)).to.equal(true);

      await expect(crystal.connect(alice).withdraw(id, [n], [E(1)], 0, alice.address))
        .to.be.revertedWithCustomError(crystal, 'CrystalSealed')
        .withArgs(unlock);
      await expect(crystal.connect(alice).withdrawAllAndBurn(id, alice.address)).to.be.revertedWithCustomError(
        crystal,
        'CrystalSealed',
      );
      // adding is still allowed while sealed
      await crystal.connect(alice).addTo(id, [n], [E(1)]);

      await time.increaseTo(unlock);
      expect(await crystal.isSealed(id)).to.equal(false);
      await crystal.connect(alice).withdraw(id, [n], [E(11)], E(1), alice.address);
    });

    it('can be extended but never shortened', async () => {
      const { crystal, alice, nvda } = await loadFixture(deploy);
      const id = await forge(crystal, alice, [await nvda.getAddress()], [E(1)]);
      const t = await time.latest();
      await crystal.connect(alice).seal(id, t + 1000);
      await crystal.connect(alice).seal(id, t + 5000);
      expect(await crystal.sealedUntil(id)).to.equal(t + 5000);
      await expect(crystal.connect(alice).seal(id, t + 2000))
        .to.be.revertedWithCustomError(crystal, 'SealCanOnlyBeExtended')
        .withArgs(t + 5000);
      await expect(crystal.connect(alice).seal(id, t + 5000)).to.be.revertedWithCustomError(
        crystal,
        'SealCanOnlyBeExtended',
      );
      await expect(crystal.connect(alice).seal(id, t - 1)).to.be.revertedWithCustomError(crystal, 'SealMustBeInFuture');
      await expect(crystal.connect(alice).seal(id, t + 101 * 365 * 24 * 3600)).to.be.revertedWithCustomError(
        crystal,
        'SealTooLong',
      );
    });

    it('a sealed crystal can still be transferred (that is the gift); the seal travels with it', async () => {
      const { crystal, alice, bob, nvda } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const id = await forge(crystal, alice, [n], [E(10)]);
      const unlock = (await time.latest()) + 86400;
      await crystal.connect(alice).seal(id, unlock);
      await crystal.connect(alice).transferFrom(alice.address, bob.address, id);
      expect(await crystal.ownerOf(id)).to.equal(bob.address);
      await expect(crystal.connect(bob).withdraw(id, [n], [E(1)], 0, bob.address)).to.be.revertedWithCustomError(
        crystal,
        'CrystalSealed',
      );
      // the recipient cannot shorten it either
      await expect(crystal.connect(bob).seal(id, unlock - 10)).to.be.revertedWithCustomError(
        crystal,
        'SealCanOnlyBeExtended',
      );
      await time.increaseTo(unlock);
      await crystal.connect(bob).withdraw(id, [n], [E(10)], 0, bob.address);
    });
  });

  describe('input rules', () => {
    it('max 8 assets (ETH counts as one)', async () => {
      const { crystal, alice, mk } = await loadFixture(deploy);
      const tokens: MockERC20[] = [];
      for (let i = 0; i < 9; i++) tokens.push(await mk(`T${i}`));
      const addrs = await Promise.all(tokens.map((t) => t.getAddress()));
      const ones = addrs.map(() => E(1));

      await forge(crystal, alice, addrs.slice(0, 8), ones.slice(0, 8)); // 8 tokens ok
      await expect(crystal.connect(alice).forge(addrs, ones)).to.be.revertedWithCustomError(crystal, 'TooManyAssets');
      await expect(
        crystal.connect(alice).forge(addrs.slice(0, 8), ones.slice(0, 8), { value: 1n }),
      ).to.be.revertedWithCustomError(crystal, 'TooManyAssets');

      // addTo cannot push past 8 either
      const id = await forge(crystal, alice, addrs.slice(0, 7), ones.slice(0, 7), 1n); // 7 + ETH = 8
      await expect(crystal.connect(alice).addTo(id, [addrs[8]!], [E(1)])).to.be.revertedWithCustomError(
        crystal,
        'TooManyAssets',
      );
      // but topping up an existing asset is fine
      await crystal.connect(alice).addTo(id, [addrs[0]!], [E(1)]);
    });

    it('rejects duplicate tokens, zero amounts, zero address, length mismatch and empty forges', async () => {
      const { crystal, alice, nvda, aapl } = await loadFixture(deploy);
      const n = await nvda.getAddress();
      const a = await aapl.getAddress();
      const c = crystal.connect(alice);
      await expect(c.forge([n, a, n], [E(1), E(1), E(1)]))
        .to.be.revertedWithCustomError(crystal, 'DuplicateToken')
        .withArgs(n);
      await expect(c.forge([n, a], [E(1), 0])).to.be.revertedWithCustomError(crystal, 'ZeroAmount');
      await expect(c.forge([ZERO], [E(1)])).to.be.revertedWithCustomError(crystal, 'ZeroAddress');
      await expect(c.forge([n], [E(1), E(1)])).to.be.revertedWithCustomError(crystal, 'LengthMismatch');
      await expect(c.forge([], [])).to.be.revertedWithCustomError(crystal, 'EmptyDeposit');
      const id = await forge(crystal, alice, [n], [E(1)]);
      await expect(c.addTo(id, [], [])).to.be.revertedWithCustomError(crystal, 'EmptyDeposit');
      await expect(c.addTo(id, [a, a], [E(1), E(1)])).to.be.revertedWithCustomError(crystal, 'DuplicateToken');
      await expect(c.withdraw(id, [n], [0], 0, alice.address)).to.be.revertedWithCustomError(crystal, 'ZeroAmount');
    });

    it('records fee-on-transfer tokens at the amount actually received', async () => {
      const { crystal, addr, alice, fee } = await loadFixture(deploy);
      const f = await fee.getAddress();
      await expect(crystal.connect(alice).forge([f], [E(100)]))
        .to.emit(crystal, 'Forged')
        .withArgs(1n, alice.address, [f], [E(99)], 0n);
      expect((await crystal.holdings(1))[1]).to.deep.equal([E(99)]);
      expect(await fee.balanceOf(addr)).to.equal(E(99));
      expect(await crystal.totalRecorded(f)).to.equal(E(99));
      // the full recorded amount can be withdrawn without breaking accounting
      await crystal.connect(alice).withdraw(1, [f], [E(99)], 0, alice.address);
      expect(await fee.balanceOf(addr)).to.equal(0n);
      expect(await crystal.totalRecorded(f)).to.equal(0n);
    });
  });

  describe('reentrancy', () => {
    it('a malicious token cannot re-enter withdraw during its own transfer', async () => {
      const { crystal, addr } = await loadFixture(deploy);
      const evil = await ethers.deployContract('ReentrantToken', [addr]);
      await evil.forgeSelf(E(10));
      await evil.arm(1); // ReenterWithdraw
      await expect(evil.withdrawSelf(E(5))).to.be.revertedWithCustomError(crystal, 'ReentrancyGuardReentrantCall');
      // nothing moved
      expect((await crystal.holdings(1))[1]).to.deep.equal([E(10)]);
      expect(await evil.balanceOf(addr)).to.equal(E(10));
    });

    it('a malicious token cannot re-enter forge during a deposit', async () => {
      const { crystal, addr } = await loadFixture(deploy);
      const evil = await ethers.deployContract('ReentrantToken', [addr]);
      await evil.arm(2); // ReenterForge
      await expect(evil.forgeSelfArmed(E(10))).to.be.revertedWithCustomError(crystal, 'ReentrancyGuardReentrantCall');
    });

    it('an ETH recipient cannot re-enter withdraw from receive()', async () => {
      const { crystal, addr } = await loadFixture(deploy);
      const attacker = await ethers.deployContract('ReentrantEthReceiver', [addr]);
      await attacker.forgeWithEth({ value: E(2) });
      // the inner reentry reverts, so the ETH send fails and the whole withdraw reverts
      await expect(attacker.attack(E(1))).to.be.revertedWithCustomError(crystal, 'EthTransferFailed');
      expect((await crystal.holdings(1))[2]).to.equal(E(2));
      expect(await ethers.provider.getBalance(addr)).to.equal(E(2));
    });
  });

  describe('withdrawAllAndBurn', () => {
    it('empties every asset and burns the NFT', async () => {
      const { crystal, addr, alice, carol, nvda, aapl, usdg } = await loadFixture(deploy);
      const ts = [await nvda.getAddress(), await aapl.getAddress(), await usdg.getAddress()];
      const id = await forge(crystal, alice, ts, [E(10), E(5), 7_000_000n], E(1.5));
      const ethBefore = await ethers.provider.getBalance(carol.address);
      await expect(crystal.connect(alice).withdrawAllAndBurn(id, carol.address))
        .to.emit(crystal, 'Burned')
        .withArgs(id, carol.address, ts, [E(10), E(5), 7_000_000n], E(1.5));
      expect(await nvda.balanceOf(carol.address)).to.equal(E(1_000_010));
      expect(await usdg.balanceOf(carol.address)).to.equal(E(1_000_000) + 7_000_000n);
      expect((await ethers.provider.getBalance(carol.address)) - ethBefore).to.equal(E(1.5));
      expect(await nvda.balanceOf(addr)).to.equal(0n);
      expect(await ethers.provider.getBalance(addr)).to.equal(0n);
      await expect(crystal.ownerOf(id)).to.be.revertedWithCustomError(crystal, 'ERC721NonexistentToken');
      await expect(crystal.holdings(id)).to.be.revertedWithCustomError(crystal, 'ERC721NonexistentToken');
      for (const t of ts) expect(await crystal.totalRecorded(t)).to.equal(0n);
      expect(await crystal.totalEthRecorded()).to.equal(0n);
    });
  });

  describe('tokenURI', () => {
    it('is fully on-chain base64 JSON with holdings, sealed status and an SVG image', async () => {
      const { crystal, alice, nvda, usdg } = await loadFixture(deploy);
      const id = await forge(
        crystal,
        alice,
        [await nvda.getAddress(), await usdg.getAddress()],
        [E('12.5'), 3_250_000n],
        E('0.25'),
      );
      const decode = async () => {
        const uri = await crystal.tokenURI(id);
        expect(uri.startsWith('data:application/json;base64,')).to.equal(true);
        return JSON.parse(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8'));
      };
      let meta = await decode();
      expect(meta.name).to.equal('PRISM Crystal #1');
      const attrs = Object.fromEntries(meta.attributes.map((a: { trait_type: string; value: unknown }) => [a.trait_type, a.value]));
      expect(attrs).to.include({ Assets: 3, ETH: '0.25', NVDA: '12.5', USDG: '3.25', Sealed: 'No' });
      expect(meta.image.startsWith('data:image/svg+xml;base64,')).to.equal(true);
      const svg = Buffer.from(meta.image.split(',')[1], 'base64').toString('utf8');
      expect(svg).to.contain('<svg').and.contain('#d4f000').and.contain('#f6c143').and.contain('PRISM #1');
      expect(svg).to.not.contain('SEALED');
      expect(JSON.stringify(meta)).to.not.match(/https?:\/\/(?!www\.w3\.org)/); // no external URLs

      const unlock = (await time.latest()) + 1000;
      await crystal.connect(alice).seal(id, unlock);
      meta = await decode();
      const sealedAttrs = Object.fromEntries(meta.attributes.map((a: { trait_type: string; value: unknown }) => [a.trait_type, a.value]));
      expect(sealedAttrs.Sealed).to.equal('Yes');
      expect(sealedAttrs.Unlocks).to.equal(unlock);
      expect(Buffer.from(meta.image.split(',')[1], 'base64').toString('utf8')).to.contain('SEALED');
    });

    it('sanitizes hostile token symbols so the JSON stays valid', async () => {
      const { crystal, addr, alice } = await loadFixture(deploy);
      const bad = await ethers.deployContract('MockERC20', ['x', 'A"},{"x":"<script>', 18]);
      await bad.mint(alice.address, E(1));
      await bad.connect(alice).approve(addr, E(1));
      await forge(crystal, alice, [await bad.getAddress()], [E(1)]);
      const uri = await crystal.tokenURI(1);
      const meta = JSON.parse(Buffer.from(uri.split(',')[1]!, 'base64').toString('utf8'));
      const names = meta.attributes.map((a: { trait_type: string }) => a.trait_type);
      // 'A"},{"x":"<s' → first 12 chars, every unsafe char replaced with '_'
      expect(names).to.include('A_____x____s');
      for (const n of names) expect(n).to.match(/^[A-Za-z0-9._-]+$/);
    });
  });

  describe('accounting invariant', () => {
    it('contract balance of every token >= sum of crystals’ recorded balances, through a random sequence', async () => {
      const { crystal, addr, alice, bob, carol, nvda, aapl, usdg, fee } = await loadFixture(deploy);
      const users = [alice, bob, carol];
      const tokens = [nvda, aapl, usdg];
      // fee token only for alice (only she has it)
      const ids: bigint[] = [];
      let seed = 42;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed % n;
      };

      const check = async () => {
        for (const t of [...tokens, fee]) {
          const ta = await t.getAddress();
          let sum = 0n;
          for (const id of ids) {
            const [ts, bs] = await crystal.holdings(id).catch(() => [[], [], 0n] as unknown as [string[], bigint[], bigint]);
            ts.forEach((x, i) => {
              if (x === ta) sum += bs[i]!;
            });
          }
          expect(await crystal.totalRecorded(ta)).to.equal(sum);
          expect(await t.balanceOf(addr)).to.be.gte(sum);
        }
        let ethSum = 0n;
        for (const id of ids) {
          const h = await crystal.holdings(id).catch(() => null);
          if (h) ethSum += h[2];
        }
        expect(await crystal.totalEthRecorded()).to.equal(ethSum);
        expect(await ethers.provider.getBalance(addr)).to.be.gte(ethSum);
      };

      for (let step = 0; step < 40; step++) {
        const op = rand(5);
        const live = [];
        for (const id of ids) {
          try {
            live.push({ id, owner: await crystal.ownerOf(id) });
          } catch {
            /* burned */
          }
        }
        const pickUser = users[rand(3)]!;
        if (op === 0 || live.length === 0) {
          const t = tokens[rand(3)]!;
          const withFee = pickUser === alice && rand(2) === 0;
          const list = withFee ? [await t.getAddress(), await fee.getAddress()] : [await t.getAddress()];
          const amts = list.map(() => BigInt(1 + rand(1000)) * 10n ** 15n);
          ids.push(await forge(crystal, pickUser, list, amts, BigInt(rand(3)) * 10n ** 16n));
        } else {
          const c = live[rand(live.length)]!;
          const owner = users.find((u) => u.address === c.owner)!;
          const [ts, bs, eth] = await crystal.holdings(c.id);
          if (op === 1) {
            const t = tokens[rand(3)]!;
            await crystal
              .connect(owner)
              .addTo(c.id, [await t.getAddress()], [BigInt(1 + rand(500)) * 10n ** 15n], { value: 10n ** 15n })
              .catch(() => undefined); // may hit max-assets; fine
          } else if (op === 2 && ts.length > 0) {
            const i = rand(ts.length);
            const amt = bs[i]! / BigInt(1 + rand(3));
            if (amt > 0n) await crystal.connect(owner).withdraw(c.id, [ts[i]!], [amt], eth / 2n, owner.address);
          } else if (op === 3) {
            const to = users[rand(3)]!;
            await crystal.connect(owner).transferFrom(owner.address, to.address, c.id);
          } else if (op === 4 && rand(4) === 0) {
            await crystal.connect(owner).withdrawAllAndBurn(c.id, owner.address);
          }
        }
        await check();
      }
    });
  });
});

describe('exported ABI for the web app', () => {
  it('packages/core/src/abi/prismCrystal.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(
      readFileSync(path.join(__dirname, '../artifacts/contracts/PrismCrystal.sol/PrismCrystal.json'), 'utf8'),
    );
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismCrystal.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismCrystalAbi = ') + 'prismCrystalAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismCrystalBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});
