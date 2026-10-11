/**
 * LOCAL FORK ONLY (refuses anything else): fills a fork of Robinhood Chain Testnet with a realistic
 * review scenario for checking the website, using the fork's own test accounts. Never run it against
 * the real chain: PRISM never generates activity there.
 *
 *   FORK=1 npx hardhat node                                 (terminal 1)
 *   npx hardhat run scripts/seed-fork.ts --network localhost (terminal 2)
 *
 * Buys a real ETH-paired v6 launch on its curve for six accounts and AAPL through its V4 pool for two,
 * posts reviews, then: one holder trims 30%, one sells everything (SOLD, not yet permanent), one sells
 * and another marks it SOLD (permanent, a truth keeper). Prints the addresses to use.
 */
import { ethers, network } from 'hardhat';

const REVIEWS = '0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3';
const PROFILES = '0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300';
const V6_FACTORY = '0xe794217880011f9cA6961340eD5c16EC9559Fea0';
const V6_LAUNCHED = '0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8';
const AAPL = '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V6_BUY = '0xf0a92630';

const erc20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function symbol() view returns (string)', 'function transfer(address,uint256) returns (bool)'];
const curveAbi = ['function complete() view returns (bool)', 'function sell(uint256 amountIn, uint256 minOut, address recipient, uint256 deadline)'];
const reviewsAbi = ['function post(address token, uint8 rating, string text) returns (uint256)', 'function markSold(uint256 id)', 'function reviewCount() view returns (uint256)'];
const profilesAbi = ['function setProfile(string name, uint256 avatarId, string bio, string x)'];

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const forked = await network.provider.send('eth_getCode', [REVIEWS, 'latest']);
  if (network.name !== 'localhost' && network.name !== 'hardhat') throw new Error('Fork only: run with --network localhost');
  if (chainId !== 46630n || forked === '0x') throw new Error('Not a fork of Robinhood Chain Testnet');

  await network.provider.send('evm_mine'); // a local block first: the fork's own block has no known hardfork
  const s = await ethers.getSigners();
  const deadline = async () => (await ethers.provider.getBlock('latest'))!.timestamp + 600;
  const head = await ethers.provider.getBlockNumber();

  // the newest ETH-paired v6 launch still on its curve
  const logs = (await ethers.provider.getLogs({ address: V6_FACTORY, topics: [V6_LAUNCHED], fromBlock: head - 40_000, toBlock: head - 2 })).reverse();
  let token = '';
  let curve = '';
  for (const l of logs) {
    if (!/^0{64}$/.test(l.data.slice(2 + 4 * 64, 2 + 5 * 64))) continue;
    const c = new ethers.Contract(ethers.getAddress(`0x${l.data.slice(26, 66)}`), curveAbi, s[0]);
    if (await c.complete()) continue;
    token = ethers.getAddress(`0x${l.topics[3]!.slice(26)}`);
    curve = await c.getAddress();
    break;
  }
  if (!token) throw new Error('no ETH-paired v6 launch on its curve');
  const buy = async (who: (typeof s)[number], eth: string) => {
    const amount = ethers.parseEther(eth);
    const data = V6_BUY + ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'address', 'uint256'], [amount, 0, who.address, await deadline()]).slice(2);
    await (await who.sendTransaction({ to: curve, data, value: amount })).wait();
  };
  const T = (who: (typeof s)[number]) => new ethers.Contract(token, erc20, who);
  const symbol = await T(s[0]!).symbol();
  const reviews = (who: (typeof s)[number]) => new ethers.Contract(REVIEWS, reviewsAbi, who);
  const post = async (who: (typeof s)[number], t: string, rating: number, text: string) => {
    await (await reviews(who).post(t, rating, text)).wait();
    return Number(await reviews(who).reviewCount());
  };
  const sell = async (who: (typeof s)[number], fraction: bigint) => {
    const bal = (await T(who).balanceOf(who.address)) as bigint;
    const amount = (bal * fraction) / 100n;
    await (await T(who).approve(curve, amount)).wait();
    await (await new ethers.Contract(curve, curveAbi, who).sell(amount, 0, who.address, await deadline())).wait();
  };

  for (const [i, eth] of [
    [1, '0.004'],
    [2, '0.003'],
    [3, '0.002'],
    [4, '0.002'],
    [5, '0.001'],
    [6, '0.001'],
  ] as const) await buy(s[i]!, eth);

  // AAPL for two of them, through its real pool
  const swapper = await ethers.deployContract('ForkV4Swapper', [POOL_MANAGER]);
  for (const i of [1, 4]) await (await swapper.connect(s[i]!).buy(AAPL, 3000, 60, { value: ethers.parseEther('0.002') })).wait();

  // usernames for two of them (PrismProfiles, on the fork)
  await (await new ethers.Contract(PROFILES, profilesAbi, s[1]!).setProfile('steady_holder', 0, 'In for the long run.', '')).wait();
  await (await new ethers.Contract(PROFILES, profilesAbi, s[4]!).setProfile('paper_hands', 0, '', '')).wait();

  await post(s[1]!, token, 5, `Clean curve, active creator. Holding ${symbol} to graduation.`);
  await post(s[2]!, token, 4, 'Good start. Tax split goes to holders, which I like.');
  const trimmer = await post(s[3]!, token, 4, 'Solid, but I took a little profit.');
  const seller = await post(s[4]!, token, 5, 'Never selling. Diamond hands 💎');
  const marked = await post(s[5]!, token, 5, 'This is the one. 100x incoming.');
  await post(s[1]!, AAPL, 4, 'Steady test stock. Nice to have something boring.');
  await post(s[4]!, AAPL, 3, 'Fine for a test stock.');

  await sell(s[3]!, 30n); // trimmed 30%
  await sell(s[4]!, 100n); // SOLD, not yet permanent
  await sell(s[5]!, 100n);
  await (await reviews(s[2]!).markSold(marked)).wait(); // made permanent by a truth keeper

  console.log(JSON.stringify({ token, curve, symbol, holderNoReview: s[6]!.address, noHoldings: s[10]!.address, holder: s[1]!.address, trimmer: s[3]!.address, trimmerReview: trimmer, seller: s[4]!.address, sellerReview: seller, truthKeeper: s[2]!.address, block: await ethers.provider.getBlockNumber() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
