import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { MockERC20, PrismReviews } from '../typechain-types';

const Status = { None: 0n, Active: 1n, Replaced: 2n, Sold: 3n };
const COOLDOWN = 3600;

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const reviews = (await ethers.deployContract('PrismReviews', [1])) as unknown as PrismReviews;
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
      expect(fns.sort()).to.deep.equal(['MAX_TEXT_BYTES', 'UPDATE_COOLDOWN', 'canMarkSold', 'firstId', 'getReview', 'markSold', 'post', 'reviewCount', 'reviewOf'].sort());
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
        .withArgs(1n, alice.address, t, 4, 1000n, 1000n, 0n, 'Solid team, slow chart.');
      const r = await reviews.getReview(1n);
      expect(r.author).to.equal(alice.address);
      expect(r.token).to.equal(t);
      expect(r.rating).to.equal(4n);
      expect(r.heldAtPost).to.equal(1000n);
      expect(r.baseline).to.equal(1000n);
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
      await expect(reviews.post(t, 3, '🚀'.repeat(70))).to.emit(reviews, 'ReviewPosted').withArgs(1n, anyValue, t, 3, 1000n, 1000n, 0n, '🚀'.repeat(70));
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
      await expect(reviews.post(t, 4, 'better now')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, t, 4, 1000n, 1000n, 1n, 'better now');
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
        .withArgs(2n, alice.address, t, 5, 100n, 100n, 1n, 'still bullish');
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
      await expect(reviews.post(await token.getAddress(), 4, 'back in')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, anyValue, 4, 5000n, 5000n, 1n, 'back in');
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

  describe('v2: the baseline (the most held since the run began)', () => {
    it('the update ladder ends SOLD: 1000 → 600 → update → 350 → update marks the run SOLD', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'all in'); // 1000
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 600n);
      // 600 is not below half of 1000: the update continues the run, keeping the baseline at 1000
      await expect(reviews.post(t, 5, 'still in')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, t, 5, 600n, 1000n, 1n, 'still in');
      expect((await reviews.getReview(2n)).baseline).to.equal(1000n);
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 350n);
      // in v1 the reference had become 600 (350 ≥ 300: never SOLD); in v2 it's still 1000
      expect(await reviews.canMarkSold(2n)).to.equal(true);
      await expect(reviews.post(t, 5, 'trust me'))
        .to.emit(reviews, 'ReviewSold')
        .withArgs(2n, alice.address, t, 350n, 1000n)
        .and.to.emit(reviews, 'ReviewPosted')
        .withArgs(3n, alice.address, t, 5, 350n, 350n, 2n, 'trust me'); // a new run starts at 350
      expect((await reviews.getReview(2n)).status).to.equal(Status.Sold);
      expect((await reviews.getReview(1n)).status).to.equal(Status.Replaced);
    });

    it('…and markSold catches the same ladder without an update', async () => {
      const { reviews, token, alice, carol, bob } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'all in');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 600n);
      await reviews.post(t, 5, 'still in');
      await setBalance(token, alice, carol.address, 499n);
      await expect(reviews.connect(bob).markSold(2n)).to.emit(reviews, 'ReviewSold').withArgs(2n, alice.address, t, 499n, 1000n);
    });

    it('buying more and updating raises the baseline', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 4, 'starter bag');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 3000n);
      await expect(reviews.post(t, 5, 'bought more')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, t, 5, 3000n, 3000n, 1n, 'bought more');
      // now below half of 3000 is SOLD, even though it's above half of the first 1000
      await setBalance(token, alice, carol.address, 1400n);
      expect(await reviews.canMarkSold(2n)).to.equal(true);
      await expect(reviews.markSold(2n)).to.emit(reviews, 'ReviewSold').withArgs(2n, alice.address, t, 1400n, 3000n);
    });

    it('a new run after SOLD starts fresh at the balance then', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'run one'); // 1000
      await setBalance(token, alice, carol.address, 10n);
      await reviews.markSold(1n);
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 200n);
      await expect(reviews.post(t, 3, 'run two')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice.address, t, 3, 200n, 200n, 1n, 'run two');
      // 150 is fine against the new run's 200 (it would be SOLD against the old 1000)
      await setBalance(token, alice, carol.address, 150n);
      expect(await reviews.canMarkSold(2n)).to.equal(false);
    });

    it('exactly half of the baseline still holds; one unit less is SOLD', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'a');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 800n);
      await reviews.post(t, 5, 'b'); // baseline stays 1000
      await setBalance(token, alice, carol.address, 500n);
      expect(await reviews.canMarkSold(2n)).to.equal(false);
      await expect(reviews.markSold(2n)).to.be.revertedWithCustomError(reviews, 'StillHolding').withArgs(500n, 1000n);
      await setBalance(token, alice, carol.address, 499n);
      await expect(reviews.markSold(2n)).to.emit(reviews, 'ReviewSold');
    });

    it('updates while holding less than the baseline keep it (it never goes down within a run)', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'a'); // 1000
      for (const [i, bal] of [
        [2n, 700n],
        [3n, 900n],
        [4n, 520n],
      ] as const) {
        await time.increase(COOLDOWN);
        await setBalance(token, alice, carol.address, bal);
        await reviews.post(t, 4, 'update');
        expect((await reviews.getReview(i)).baseline).to.equal(1000n);
        expect((await reviews.getReview(i)).heldAtPost).to.equal(bal);
      }
    });

    it('a zero balance can’t post, not even an update', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'a');
      await time.increase(COOLDOWN);
      await setBalance(token, alice, carol.address, 0n);
      await expect(reviews.post(t, 5, 'b')).to.be.revertedWithCustomError(reviews, 'NotHolder');
    });

    it('the cooldown applies to updates and to new runs after SOLD alike', async () => {
      const { reviews, token, alice, carol } = await loadFixture(deploy);
      const t = await token.getAddress();
      await reviews.post(t, 5, 'a');
      await setBalance(token, alice, carol.address, 1n);
      await reviews.markSold(1n);
      await expect(reviews.post(t, 5, 'b')).to.be.revertedWithCustomError(reviews, 'TooSoon');
      await time.increase(COOLDOWN);
      await expect(reviews.post(t, 5, 'b')).to.emit(reviews, 'ReviewPosted');
    });
  });

  describe('v2: ids continue after the first contract', () => {
    it('starts at firstId, fixed at deploy; ids below it are unknown', async () => {
      const [alice] = await ethers.getSigners();
      const reviews = (await ethers.deployContract('PrismReviews', [2])) as unknown as PrismReviews;
      const token = (await ethers.deployContract('MockERC20', ['T', 'T', 18])) as unknown as MockERC20;
      await token.mint(alice!.address, 10n);
      expect(await reviews.firstId()).to.equal(2n);
      expect(await reviews.reviewCount()).to.equal(1n); // none yet: the last id is firstId - 1
      await expect(reviews.post(await token.getAddress(), 5, 'first on v2')).to.emit(reviews, 'ReviewPosted').withArgs(2n, alice!.address, anyValue, 5, 10n, 10n, 0n, 'first on v2');
      expect(await reviews.reviewCount()).to.equal(2n);
      await expect(reviews.markSold(1n)).to.be.revertedWithCustomError(reviews, 'UnknownReview').withArgs(1n);
    });

    it('refuses a first id of 0 (0 means "none")', async () => {
      const f = await ethers.getContractFactory('PrismReviews');
      await expect(ethers.deployContract('PrismReviews', [0])).to.be.revertedWithCustomError(f, 'InvalidFirstId');
    });
  });

  describe('v2 invariants (seeded random actions, checked against a model of the rules)', function () {
    // thousands of transactions and checks: well past mocha's default timeout
    this.timeout(600_000);
    it('500 random posts, balance moves, markSold calls and waits by 3 holders on 2 tokens', async () => {
      const [a1, a2, a3, sink] = await ethers.getSigners();
      const reviews = (await ethers.deployContract('PrismReviews', [1])) as unknown as PrismReviews;
      const tokens = [
        (await ethers.deployContract('MockERC20', ['A', 'A', 18])) as unknown as MockERC20,
        (await ethers.deployContract('MockERC20', ['B', 'B', 18])) as unknown as MockERC20,
      ];
      const authors = [a1!, a2!, a3!];
      // mulberry32: a small seeded PRNG (the same sequence every run)
      let seed = 20261018;
      const rnd = (n: number) => {
        seed = (seed + 0x6d2b79f5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return (((x ^ (x >>> 14)) >>> 0) % n);
      };
      type M = { id: number; author: number; token: number; status: bigint; baseline: bigint; soldAt: bigint; previous: number; postedAt: number };
      const model = new Map<number, M>();
      const latest = new Map<string, number>();
      let next = 1;
      const isSold = (bal: bigint, base: bigint) => bal < base - base / 2n;
      for (let step = 0; step < 500; step++) {
        const ai = rnd(3);
        const ti = rnd(2);
        const author = authors[ai]!;
        const token = tokens[ti]!;
        const t = await token.getAddress();
        const action = rnd(10);
        if (action < 3) {
          // move the balance (often to values right around half)
          const target = [0n, 1n, 499n, 500n, 501n, 1000n, 2000n, 3000n][rnd(8)]! + BigInt(rnd(3)) * 37n;
          await setBalance(token, author, sink!.address, target);
        } else if (action < 4) {
          await time.increase(rnd(2) ? COOLDOWN : 600);
        } else if (action < 8) {
          const bal = await token.balanceOf(author.address);
          const key = `${ai}:${ti}`;
          const prevId = latest.get(key) ?? 0;
          const prev = prevId ? model.get(prevId)! : null;
          const now = (await time.latest()) + 1;
          await time.setNextBlockTimestamp(now);
          const tooSoon = prev !== null && now < prev.postedAt + COOLDOWN;
          const tx = reviews.connect(author).post(t, 1 + rnd(5), `step ${step}`);
          if (bal === 0n) {
            await expect(tx).to.be.revertedWithCustomError(reviews, 'NotHolder');
            continue;
          }
          if (tooSoon) {
            await expect(tx).to.be.revertedWithCustomError(reviews, 'TooSoon');
            continue;
          }
          await (await tx).wait();
          let baseline = bal;
          if (prev && prev.status === Status.Active) {
            if (isSold(bal, prev.baseline)) Object.assign(prev, { status: Status.Sold, soldAt: BigInt(now) });
            else {
              prev.status = Status.Replaced;
              if (prev.baseline > baseline) baseline = prev.baseline;
            }
          }
          model.set(next, { id: next, author: ai, token: ti, status: Status.Active, baseline, soldAt: 0n, previous: prevId, postedAt: now });
          latest.set(key, next++);
        } else if (model.size) {
          const id = 1 + rnd(next - 1);
          const m = model.get(id)!;
          const bal = await tokens[m.token]!.balanceOf(authors[m.author]!.address);
          const now = (await time.latest()) + 1;
          await time.setNextBlockTimestamp(now);
          const tx = reviews.connect(sink!).markSold(id);
          if (m.status !== Status.Active) await expect(tx).to.be.revertedWithCustomError(reviews, 'NotActive');
          else if (!isSold(bal, m.baseline)) await expect(tx).to.be.revertedWithCustomError(reviews, 'StillHolding');
          else {
            await (await tx).wait();
            Object.assign(m, { status: Status.Sold, soldAt: BigInt(now) });
          }
        }
        // the contract agrees with the model on every review, after every step (so SOLD never changed back)
        for (const m of model.values()) {
          const r = await reviews.getReview(m.id);
          expect([r.status, r.baseline, r.soldAt, r.previous], `review ${m.id} at step ${step}`).to.deep.equal([m.status, m.baseline, m.soldAt, BigInt(m.previous)]);
        }
      }
      // within a run (a link that doesn't cross a SOLD review) the baseline never goes down
      let runs = 0;
      for (const m of model.values()) {
        const p = m.previous ? model.get(m.previous)! : null;
        if (p && p.status !== Status.Sold) expect(m.baseline >= p.baseline, `review ${m.id}`).to.equal(true);
        else runs++;
      }
      expect(next - 1).to.be.greaterThan(60); // enough reviews were actually posted
      expect(runs).to.be.greaterThan(5);
      expect([...model.values()].filter((m) => m.status === Status.Sold).length).to.be.greaterThan(5);
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
