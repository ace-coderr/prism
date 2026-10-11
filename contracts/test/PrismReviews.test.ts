import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { MockERC20, PrismReviews } from '../typechain-types';

const Status = { None: 0n, Active: 1n, Replaced: 2n, Sold: 3n };
const COOLDOWN = 3600;

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const reviews = (await ethers.deployContract('PrismReviews')) as unknown as PrismReviews;
  const token = (await ethers.deployContract('MockERC20', ['Moon Dog', 'MOON', 18])) as unknown as MockERC20;
  const other = (await ethers.deployContract('MockERC20', ['Other', 'OTH', 18])) as unknown as MockERC20;
  await token.mint(alice.address, 1000n);
  await other.mint(alice.address, 50n);
  return { reviews, token, other, alice, bob, carol };
}

/** Moves alice's balance of `token` to exactly `amount` (the rest goes to carol). */
async function setBalance(token: MockERC20, from: Awaited<ReturnType<typeof ethers.getSigner>>, to: string, amount: bigint) {
  const now = await token.balanceOf(from.address);
  if (now > amount) await token.connect(from).transfer(to, now - amount);
  else if (now < amount) await token.mint(from.address, amount - now);
}

describe('PrismReviews', () => {
  describe('no owner, no money', () => {
    it('has no admin, delete, edit, withdraw or payable function at all', async () => {
      const { reviews } = await loadFixture(deploy);
      const fns = reviews.interface.fragments.filter((f) => f.type === 'function').map((f) => (f as { name: string }).name);
      expect(fns.sort()).to.deep.equal(['MAX_TEXT_BYTES', 'UPDATE_COOLDOWN', 'canMarkSold', 'getReview', 'markSold', 'post', 'reviewCount', 'reviewOf'].sort());
      for (const f of reviews.interface.fragments) {
        if (f.type === 'function') expect((f as { payable: boolean }).payable, (f as { name: string }).name).to.equal(false);
      }
      expect(reviews.interface.fragments.some((f) => f.type === 'receive' || f.type === 'fallback')).to.equal(false);
    });

    it('rejects ETH: a plain transfer, and ETH sent along with post()', async () => {
      const { reviews, token, alice } = await loadFixture(deploy);
      const to = await reviews.getAddress();
      await expect(alice.sendTransaction({ to, value: 1n })).to.be.reverted;
      const data = reviews.interface.encodeFunctionData('post', [await token.getAddress(), 5, 'hi']);
      await expect(alice.sendTransaction({ to, data, value: 1n })).to.be.reverted;
      expect(await ethers.provider.getBalance(to)).to.equal(0n);
    });
  });

  describe('post: holders only', () => {
    it('stores author, token, rating, balance held, time and status; the text is in the event', async () => {
      const { reviews, token, alice } = await loadFixture(deploy);
      const t = await token.getAddress();
      await expect(reviews.post(t, 4, 'Solid team, slow chart.'))
        .to.emit(reviews, 'ReviewPosted')
        .withArgs(1n, alice.address, t, 4, 1000n, 0n, 'Solid team, slow chart.');
      const r = await reviews.getReview(1n);
      expect(r.author).to.equal(alice.address);
      expect(r.token).to.equal(t);
      expect(r.rating).to.equal(4n);
      expect(r.heldAtPost).to.equal(1000n);
      expect(r.postedAt).to.equal(BigInt(await time.latest()));
      expect(r.status).to.equal(Status.Active);
      expect(r.soldAt).to.equal(0n);
      expect(r.previous).to.equal(0n);
      const [id, again] = await reviews.reviewOf(alice.address, t);
      expect(id).to.equal(1n);
      expect(again.heldAtPost).to.equal(1000n);
      expect(await reviews.reviewCount()).to.equal(1n);
    });

    it('refuses anyone holding none of the token', async () => {
      const { reviews, token, bob } = await loadFixture(deploy);
      const t = await token.getAddress();
      await expect(reviews.connect(bob).post(t, 5, 'to the moon')).to.be.revertedWithCustomError(reviews, 'NotHolder').withArgs(t);
      await token.mint(bob.address, 1n); // one base unit is enough
      await expect(reviews.connect(bob).post(t, 5, 'to the moon')).to.emit(reviews, 'ReviewPosted');
    });

    it('refuses addresses that are not tokens (no code, or no balanceOf)', async () => {
      const { reviews, bob } = await loadFixture(deploy);
      await expect(reviews.post(bob.address, 3, 'x')).to.be.revertedWithCustomError(reviews, 'NotAToken').withArgs(bob.address);
      const self = await reviews.getAddress();
      await expect(reviews.post(self, 3, 'x')).to.be.revertedWithCustomError(reviews, 'NotAToken').withArgs(self);
    });

    it('rating must be 1–5', async () => {
      const { reviews, token } = await loadFixture(deploy);
      const t = await token.getAddress();
      await expect(reviews.post(t, 0, 'x')).to.be.revertedWithCustomError(reviews, 'InvalidRating').withArgs(0);
      await expect(reviews.post(t, 6, 'x')).to.be.revertedWithCustomError(reviews, 'InvalidRating').withArgs(6);
      await expect(reviews.post(t, 1, 'x')).to.emit(reviews, 'ReviewPosted');
      await time.increase(COOLDOWN);
      await expect(reviews.post(t, 5, 'x')).to.emit(reviews, 'ReviewPosted');
    });

    it('text is at most 280 bytes (UTF-8, so emoji count 4); empty is fine', async () => {
      const { reviews, token, other } = await loadFixture(deploy);
      const t = await token.getAddress();
      await expect(reviews.post(t, 3, 'a'.repeat(281))).to.be.revertedWithCustomError(reviews, 'TextTooLong').withArgs(281);
      await expect(reviews.post(t, 3, '🚀'.repeat(71))).to.be.revertedWithCustomError(reviews, 'TextTooLong').withArgs(284);
      await expect(reviews.post(t, 3, '🚀'.repeat(70))).to.emit(reviews, 'ReviewPosted').withArgs(1n, anyValue, t, 3, 1000n, 0n, '🚀'.repeat(70));
      await expect(reviews.post(await other.getAddress(), 3, '')).to.emit(reviews, 'ReviewPosted');
    });
  });

  describe('updates', () => {
    it('one current review per author per token: a new one replaces it, linked, after the cooldown', async () => {
      const { reviews, token, alice } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 2, 'meh');
      const availableAt = BigInt(await time.latest()) + BigInt(COOLDOWN);
      await expect(reviews.post(t, 4, 'better now')).to.be.revertedWithCustomError(reviews, 'TooSoon').withArgs(availableAt);
      await time.setNextBlockTimestamp(availableAt - 1n);
      await expect(reviews.post(t, 4, 'better now')).to.be.revertedWithCustomError(reviews, 'TooSoon');
      await time.setNextBlockTimestamp(availableAt);
      await expect(reviews.post(t, 4, 'better now')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, t, 4, 1000n, 1n, 'better now');
      expect((await reviews.getReview(1n)).status).to.equal(Status.Replaced);
      expect((await reviews.getReview(2n)).status).to.equal(Status.Active);
      expect((await reviews.getReview(2n)).previous).to.equal(1n);
      expect((await reviews.reviewOf(alice.address, t))[0]).to.equal(2n);
    });

    it('only while still holding', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'gem');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 0n);
      await expect(reviews.post(t, 1, 'rug')).to.be.revertedWithCustomError(reviews, 'NotHolder').withArgs(t);
      expect((await reviews.getReview(1n)).status).to.equal(Status.Active); // nothing changed
    });

    it('an update can’t wash away a sale: below half, the old review becomes SOLD first', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'diamond hands');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 100n);
      await expect(reviews.post(t, 5, 'still bullish'))
        .to.emit(reviews, 'ReviewSold')
        .withArgs(1n, alice.address, t, 100n, 1000n)
        .and.to.emit(reviews, 'ReviewPosted')
        .withArgs(2n, alice.address, t, 5, 100n, 1n, 'still bullish');
      expect((await reviews.getReview(1n)).status).to.equal(Status.Sold);
    });

    it('the cooldown is per author and per token', async () => {
      const { reviews, token, other, alice, bob } = await loadFixture(deploy);
      const t = await token.getAddress();
      await token.mint(bob.address, 5n);
      await reviews.post(t, 3, 'a');
      await expect(reviews.post(await other.getAddress(), 3, 'b')).to.emit(reviews, 'ReviewPosted');
      await expect(reviews.connect(bob).post(t, 3, 'c')).to.emit(reviews, 'ReviewPosted');
      expect((await reviews.reviewOf(alice.address, t))[0]).to.equal(1n);
      expect((await reviews.reviewOf(bob.address, t))[0]).to.equal(3n);
    });
  });

  describe('markSold', () => {
    async function posted(held: bigint) {
      const f = await loadFixture(deploy);
      await setBalance(f.token, f.alice, f.carol.address, held);
      await f.reviews.post(await f.token.getAddress(), 5, 'holding');
      return f;
    }

    for (const [left, sold] of [
      [490n, true], // 49% left (a 51% drop): SOLD
      [500n, false], // exactly 50% left: still holding
      [510n, false], // 51% left (a 49% drop): still holding
    ] as const) {
      it(`${Number(left) / 10}% of the posted balance left → ${sold ? 'SOLD' : 'still holding'}`, async () => {
        const { reviews, token, alice, carol, bob } = await posted(1000n);
        await setBalance(token, alice, carol.address, left);
        expect(await reviews.canMarkSold(1n)).to.equal(sold);
        if (sold) {
          // anyone can call it, here bob
          await expect(reviews.connect(bob).markSold(1n)).to.emit(reviews, 'ReviewSold').withArgs(1n, alice.address, await token.getAddress(), left, 1000n);
          const r = await reviews.getReview(1n);
          expect(r.status).to.equal(Status.Sold);
          expect(r.soldAt).to.equal(BigInt(await time.latest()));
        } else {
          await expect(reviews.connect(bob).markSold(1n)).to.be.revertedWithCustomError(reviews, 'StillHolding').withArgs(left, 1000n);
          expect((await reviews.getReview(1n)).status).to.equal(Status.Active);
        }
      });
    }

    it('“below half” is exact for odd balances too (101 → 50 is SOLD, 51 is not)', async () => {
      const { reviews, token, alice, carol } = await posted(101n);
      await setBalance(token, alice, carol.address, 51n);
      expect(await reviews.canMarkSold(1n)).to.equal(false);
      await setBalance(token, alice, carol.address, 50n);
      await expect(reviews.markSold(1n)).to.emit(reviews, 'ReviewSold');
    });

    it('SOLD is permanent: buying back changes nothing, and it can’t be marked again', async () => {
      const { reviews, token, alice, carol } = await posted(1000n);
      await setBalance(token, alice, carol.address, 0n);
      await reviews.markSold(1n);
      const soldAt = (await reviews.getReview(1n)).soldAt;
      await setBalance(token, alice, carol.address, 5000n);
      await time.increase(COOLDOWN);
      await expect(reviews.markSold(1n)).to.be.revertedWithCustomError(reviews, 'NotActive').withArgs(1n, Status.Sold);
      // a fresh review after buying back is a new review; the SOLD one stays SOLD
      await expect(reviews.post(await token.getAddress(), 4, 'back in')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, anyValue, 4, 5000n, 1n, 'back in');
      const r = await reviews.getReview(1n);
      expect(r.status).to.equal(Status.Sold);
      expect(r.soldAt).to.equal(soldAt);
    });

    it('only the current review can be marked; unknown ids are refused', async () => {
      const { reviews, token, alice, carol } = await posted(1000n);
      await time.increase(COOLDOWN);
      await reviews.post(await token.getAddress(), 4, 'update');
      await setBalance(token, alice, carol.address, 0n);
      await expect(reviews.markSold(1n)).to.be.revertedWithCustomError(reviews, 'NotActive').withArgs(1n, Status.Replaced);
      await expect(reviews.markSold(2n)).to.emit(reviews, 'ReviewSold');
      await expect(reviews.markSold(99n)).to.be.revertedWithCustomError(reviews, 'UnknownReview').withArgs(99n);
      expect(await reviews.canMarkSold(99n)).to.equal(false);
    });
  });

  describe('nothing is ever deleted', () => {
    it('every review stays readable, with its rating, balance and status, through updates and sales', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 1, 'first');
      await time.increase(COOLDOWN);
      await reviews.post(t, 2, 'second');
      await time.increase(COOLDOWN);
      await reviews.post(t, 3, 'third');
      await setBalance(token, alice, carol.address, 0n);
      await reviews.markSold(3n);
      const all = await Promise.all([1n, 2n, 3n].map((id) => reviews.getReview(id)));
      expect(all.map((r) => [r.rating, r.status, r.previous])).to.deep.equal([
        [1n, Status.Replaced, 0n],
        [2n, Status.Replaced, 1n],
        [3n, Status.Sold, 2n],
      ]);
      // and every text is in the logs
      const logs = await reviews.queryFilter(reviews.filters.ReviewPosted());
      expect(logs.map((l) => l.args.text)).to.deep.equal(['first', 'second', 'third']);
    });
  });
});

describe('PrismReviews exported for the web app', () => {
  it('packages/core/src/abi/prismReviews.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(readFileSync(path.join(__dirname, '../artifacts/contracts/PrismReviews.sol/PrismReviews.json'), 'utf8'));
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismReviews.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismReviewsAbi = ') + 'prismReviewsAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismReviewsBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});
