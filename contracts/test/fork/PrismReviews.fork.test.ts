/**
 * Fork test: PrismReviews against real tokens on Robinhood Chain Testnet at its latest block
 * (`npm run test:fork`). Nothing is sent to the real chain: the local fork's own accounts buy a
 * real vibe/vibe launch token on its bonding curve (gen 2 and v6, newest launches still on their
 * curve) and a real test stock through its Uniswap V4 pool, review it, sell it, and get the
 * review marked SOLD.
 */
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { PrismReviews } from '../../typechain-types';

const FORK = process.env.FORK === '1';
const E = (n: string) => ethers.parseEther(n);

// vibe/vibe factories (packages/core/src/launches.ts)
const GEN2_FACTORY = '0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59';
const V6_FACTORY = '0xe794217880011f9cA6961340eD5c16EC9559Fea0';
const TOKEN_LAUNCHED = '0x56eef5c350583250e71791d6d659f4d181796c9deb08b977252efc3995aa9279';
const V6_LAUNCHED = '0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8';
// test stock + its pool (packages/core/src/tokens.ts)
const AAPL = '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';

const erc20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function symbol() view returns (string)'];
// curve functions, from their selectors (the curves are unverified)
const gen2Curve = ['function graduated() view returns (bool)', 'function buy(uint256 minTokensOut, uint256 deadline) payable', 'function sell(uint256 tokensIn, uint256 minEthOut, uint256 deadline)'];
const v6Curve = ['function complete() view returns (bool)', 'function pairCurrency() view returns (address)', 'function sell(uint256 amountIn, uint256 minOut, address recipient, uint256 deadline)'];
const V6_BUY = '0xf0a92630'; // (uint256 amountIn, uint256 minOut, address recipient, uint256 deadline) payable

const addr = (topic: string) => ethers.getAddress(`0x${topic.slice(26)}`);

(FORK ? describe : describe.skip)('PrismReviews on a fork of Robinhood Chain Testnet', function () {
  this.timeout(600_000);
  let reviews: PrismReviews;
  type Signer = Awaited<ReturnType<typeof ethers.getSigner>>;
  let me: Signer;

  before(async () => {
    await network.provider.send('evm_mine'); // a local block first: the fork's own block has no known hardfork
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    [me] = await ethers.getSigners();
    reviews = (await ethers.deployContract('PrismReviews', [1])) as unknown as PrismReviews;
  });

  /** Newest launches of a factory in the last `blocks` blocks, newest first. */
  async function recentLaunches(factory: string, topic: string, blocks = 20_000) {
    const head = await ethers.provider.getBlockNumber();
    const logs = await ethers.provider.getLogs({ address: factory, topics: [topic], fromBlock: head - blocks, toBlock: head - 2 });
    return logs.reverse();
  }

  const deadline = async () => (await ethers.provider.getBlock('latest'))!.timestamp + 600;

  async function reviewSellMark(token: string, sell: () => Promise<unknown>) {
    const t = new ethers.Contract(token, erc20, me);
    const held = (await t.balanceOf(me.address)) as bigint;
    expect(held).to.be.gt(0n);
    await expect(reviews.post(token, 5, `bought ${await t.symbol()} for real`)).to.emit(reviews, 'ReviewPosted');
    const id = await reviews.reviewCount();
    expect((await reviews.getReview(id)).heldAtPost).to.equal(held);
    await expect(reviews.markSold(id)).to.be.revertedWithCustomError(reviews, 'StillHolding');
    await sell();
    const left = (await t.balanceOf(me.address)) as bigint;
    expect(left * 2n).to.be.lt(held);
    expect(await reviews.canMarkSold(id)).to.equal(true);
    await expect(reviews.connect((await ethers.getSigners())[1]!).markSold(id)).to.emit(reviews, 'ReviewSold').withArgs(id, me.address, token, left, held);
    const r = await reviews.getReview(id);
    expect(r.status).to.equal(3n); // SOLD
    return { held, left };
  }

  it('gen 2 launch: buy on its curve → review → sell back to the curve → markSold → SOLD', async () => {
    for (const l of await recentLaunches(GEN2_FACTORY, TOKEN_LAUNCHED)) {
      const token = addr(l.topics[2]!);
      const curve = new ethers.Contract(addr(l.topics[3]!), gen2Curve, me);
      if (await curve.graduated()) continue;
      try {
        await (await curve.buy(0, await deadline(), { value: E('0.001') })).wait();
      } catch {
        continue; // this curve won't sell right now (e.g. just launched): try the next one
      }
      const { held, left } = await reviewSellMark(token, async () => {
        const t = new ethers.Contract(token, erc20, me);
        await (await t.approve(await curve.getAddress(), ethers.MaxUint256)).wait();
        await (await curve.sell(await t.balanceOf(me.address), 0, await deadline())).wait();
      });
      console.log(`      gen 2 ${token}: held ${held}, ${left} left after selling`);
      return;
    }
    throw new Error('no gen 2 launch still on its curve in the last 20k blocks');
  });

  it('v6 launch (ETH-paired): buy on its curve → review → sell → markSold → SOLD', async () => {
    for (const l of await recentLaunches(V6_FACTORY, V6_LAUNCHED, 50_000)) {
      if (!/^0x0{64}$/.test(`0x${l.data.slice(2 + 4 * 64, 2 + 5 * 64)}`)) continue; // ETH-paired only
      const token = addr(l.topics[3]!);
      const curveAddress = ethers.getAddress(`0x${l.data.slice(26, 66)}`);
      const curve = new ethers.Contract(curveAddress, v6Curve, me);
      if (await curve.complete()) continue;
      const amount = E('0.001');
      const data = V6_BUY + ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'address', 'uint256'], [amount, 0, me.address, await deadline()]).slice(2);
      try {
        await (await me.sendTransaction({ to: curveAddress, data, value: amount })).wait();
      } catch {
        continue;
      }
      const { held, left } = await reviewSellMark(token, async () => {
        const t = new ethers.Contract(token, erc20, me);
        await (await t.approve(curveAddress, ethers.MaxUint256)).wait();
        await (await curve.sell(await t.balanceOf(me.address), 0, me.address, await deadline())).wait();
      });
      console.log(`      v6 ${token}: held ${held}, ${left} left after selling`);
      return;
    }
    throw new Error('no ETH-paired v6 launch still on its curve in the last 50k blocks');
  });

  it('v2 on a real launch: the update ladder ends SOLD; buying more raises the baseline', async () => {
    for (const l of await recentLaunches(V6_FACTORY, V6_LAUNCHED, 50_000)) {
      if (!/^0x0{64}$/.test(`0x${l.data.slice(2 + 4 * 64, 2 + 5 * 64)}`)) continue; // ETH-paired only
      const token = addr(l.topics[3]!);
      const curveAddress = ethers.getAddress(`0x${l.data.slice(26, 66)}`);
      const curve = new ethers.Contract(curveAddress, v6Curve, me);
      if (await curve.complete()) continue;
      const buy = async (eth: string) => {
        const amount = E(eth);
        const data = V6_BUY + ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'address', 'uint256'], [amount, 0, me.address, await deadline()]).slice(2);
        await (await me.sendTransaction({ to: curveAddress, data, value: amount })).wait();
      };
      try {
        await buy('0.002');
      } catch {
        continue;
      }
      const t = new ethers.Contract(token, erc20, me);
      await (await t.approve(curveAddress, ethers.MaxUint256)).wait();
      const sellTo = async (left: bigint) => {
        const now = (await t.balanceOf(me.address)) as bigint;
        await (await curve.sell(now - left, 0, me.address, await deadline())).wait();
      };
      const wait = () => network.provider.send('evm_increaseTime', [3600]).then(() => network.provider.send('evm_mine'));
      const held = (await t.balanceOf(me.address)) as bigint;
      // the ladder: review, sell to 60%, update, sell to 35%, update → the run is SOLD
      await wait(); // an earlier test may have reviewed this launch less than an hour ago
      await reviews.post(token, 5, 'ladder step 1');
      const first = await reviews.reviewCount();
      await wait();
      await sellTo((held * 60n) / 100n);
      await reviews.post(token, 5, 'ladder step 2');
      const second = await reviews.reviewCount();
      expect((await reviews.getReview(second)).baseline).to.equal(held);
      await wait();
      await sellTo((held * 35n) / 100n);
      await expect(reviews.post(token, 5, 'ladder step 3')).to.emit(reviews, 'ReviewSold');
      expect((await reviews.getReview(second)).status).to.equal(3n); // SOLD
      expect((await reviews.getReview(first)).status).to.equal(2n); // replaced
      // the new run starts at 35%; buying more and updating raises its baseline
      const third = await reviews.reviewCount();
      expect((await reviews.getReview(third)).baseline).to.equal((held * 35n) / 100n);
      await buy('0.003');
      await wait();
      const more = (await t.balanceOf(me.address)) as bigint;
      await reviews.post(token, 4, 'bought more');
      expect((await reviews.getReview(await reviews.reviewCount())).baseline).to.equal(more);
      console.log(`      v6 ${token}: held ${held}, run 2 baseline ${more}`);
      return;
    }
    throw new Error('no ETH-paired v6 launch still on its curve in the last 50k blocks');
  });

  it('test stock (AAPL): buy through its V4 pool → review → sell → markSold → SOLD', async () => {
    const swapper = await ethers.deployContract('ForkV4Swapper', [POOL_MANAGER]);
    await (await swapper.buy(AAPL, 3000, 60, { value: E('0.002') })).wait();
    const { held } = await reviewSellMark(AAPL, async () => {
      const t = new ethers.Contract(AAPL, erc20, me);
      const all = (await t.balanceOf(me.address)) as bigint;
      await (await t.approve(await swapper.getAddress(), all)).wait();
      await (await swapper.sell(AAPL, all - all / 3n, 3000, 60)).wait(); // sell two thirds: below half left
    });
    console.log(`      AAPL: held ${held}`);
  });

  it('rejects ETH on the fork too', async () => {
    await expect(me.sendTransaction({ to: await reviews.getAddress(), value: 1n })).to.be.reverted;
  });
});
