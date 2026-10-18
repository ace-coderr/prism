/**
 * LOCAL FORK ONLY (refuses anything else): deploys PrismReviews v2 on a fork of Robinhood Chain
 * Testnet and fills it with every case the website has to get right, using the fork's own test
 * accounts (and, on the fork only, the real launch creator's address, impersonated). Never run it
 * against the real chain: PRISM never generates activity there.
 *
 *   FORK=1 npx hardhat node                                 (terminal 1)
 *   npx hardhat run scripts/seed-fork.ts --network localhost (terminal 2)
 *
 * On a real ETH-paired v6 launch still on its curve (and AAPL through its V4 pool):
 * holders, a 30% trim, the update ladder (sell a little before each update: ends SOLD), a dump below
 * half bought back before anyone marks it (SOLD in the app), a dust position (under $1), the launch's
 * own creator reviewing it, a review of a token PRISM doesn't list, a seller marking their own review,
 * and a truth keeper marking someone else's. Time moves 8 days in the middle so honesty reps are
 * decided (run the site with the matching clock offset it prints). Prints what to check.
 */
import { ethers, network } from 'hardhat';

const REVIEWS_V1 = '0xb6f28fa52DE204cB6CccbA1dF43c52a01B9f08C3';
const PROFILES = '0xf7Da2Ee9dF52422eB87E8FBc3Be347a4B5611300';
const V6_FACTORY = '0xe794217880011f9cA6961340eD5c16EC9559Fea0';
const V6_LAUNCHED = '0xa7e8032bfd07a9fbcde50eabe91eb2901faee6dbddd9cced579491d9b07ef5c8';
const AAPL = '0x438820DcfE62A21e306614A4B54383Cd8a36AcF2';
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const V6_BUY = '0xf0a92630';
const HOUR = 3600;

const erc20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function symbol() view returns (string)', 'function transfer(address,uint256) returns (bool)'];
const curveAbi = ['function complete() view returns (bool)', 'function sell(uint256 amountIn, uint256 minOut, address recipient, uint256 deadline)'];
const v1Abi = ['function reviewCount() view returns (uint256)'];
const profilesAbi = ['function setProfile(string name, uint256 avatarId, string bio, string x)'];

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const forked = await network.provider.send('eth_getCode', [REVIEWS_V1, 'latest']);
  if (network.name !== 'localhost' && network.name !== 'hardhat') throw new Error('Fork only: run with --network localhost');
  if (chainId !== 46630n || forked === '0x') throw new Error('Not a fork of Robinhood Chain Testnet');

  await network.provider.send('evm_mine'); // a local block first: the fork's own block has no known hardfork
  const s = await ethers.getSigners();
  const wait = async (seconds: number) => {
    await network.provider.send('evm_increaseTime', [seconds]);
    await network.provider.send('evm_mine');
  };
  const deadline = async () => (await ethers.provider.getBlock('latest'))!.timestamp + 600;
  const head = await ethers.provider.getBlockNumber();

  // v2, numbering on from the first contract
  const firstId = (await new ethers.Contract(REVIEWS_V1, v1Abi, s[0]).reviewCount()) + 1n;
  const reviews = await ethers.deployContract('PrismReviews', [firstId]);
  await reviews.waitForDeployment();
  const deployTx = reviews.deploymentTransaction()!;
  const deployReceipt = (await deployTx.wait())!;

  // the newest ETH-paired v6 launch still on its curve, and who launched it
  const logs = (await ethers.provider.getLogs({ address: V6_FACTORY, topics: [V6_LAUNCHED], fromBlock: head - 40_000, toBlock: head - 2 })).reverse();
  let token = '';
  let curve = '';
  let creator = '';
  for (const l of logs) {
    if (!/^0{64}$/.test(l.data.slice(2 + 4 * 64, 2 + 5 * 64))) continue;
    const c = new ethers.Contract(ethers.getAddress(`0x${l.data.slice(26, 66)}`), curveAbi, s[0]);
    if (await c.complete()) continue;
    token = ethers.getAddress(`0x${l.topics[3]!.slice(26)}`);
    creator = ethers.getAddress(`0x${l.topics[2]!.slice(26)}`);
    curve = await c.getAddress();
    break;
  }
  if (!token) throw new Error('no ETH-paired v6 launch on its curve');
  type Who = Awaited<ReturnType<typeof ethers.getSigner>>;
  const buy = async (who: Who, eth: string) => {
    const amount = ethers.parseEther(eth);
    const data = V6_BUY + ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256', 'address', 'uint256'], [amount, 0, who.address, await deadline()]).slice(2);
    await (await who.sendTransaction({ to: curve, data, value: amount })).wait();
  };
  const T = (who: Who, t = token) => new ethers.Contract(t, erc20, who);
  const symbol = await T(s[0]!).symbol();
  const post = async (who: Who, t: string, rating: number, text: string) => {
    await (await reviews.connect(who).getFunction('post')(t, rating, text)).wait();
    return Number(await reviews.reviewCount());
  };
  const balance = async (who: Who) => (await T(who).balanceOf(who.address)) as bigint;
  /** sell down to `percent` of `of` (default: the current balance) */
  const sellTo = async (who: Who, percent: bigint, of?: bigint) => {
    const now = await balance(who);
    const left = ((of ?? now) * percent) / 100n;
    if (now <= left) return;
    await (await T(who).approve(curve, now - left)).wait();
    await (await new ethers.Contract(curve, curveAbi, who).sell(now - left, 0, who.address, await deadline())).wait();
  };

  for (const [i, eth] of [
    [1, '0.004'],
    [2, '0.003'],
    [3, '0.002'],
    [4, '0.002'],
    [5, '0.002'],
    [6, '0.002'],
    [8, '0.001'],
    [9, '0.001'],
  ] as const) await buy(s[i]!, eth);
  await buy(s[7]!, '0.0000001'); // dust: far under $1

  // AAPL for two of them, through its real pool
  const swapper = await ethers.deployContract('ForkV4Swapper', [POOL_MANAGER]);
  for (const i of [1, 2]) await (await swapper.connect(s[i]!).buy(AAPL, 3000, 60, { value: ethers.parseEther('0.002') })).wait();

  // the launch's creator, impersonated on this fork only, holding and reviewing their own launch
  await network.provider.send('hardhat_impersonateAccount', [creator]);
  await network.provider.send('hardhat_setBalance', [creator, '0x' + ethers.parseEther('1').toString(16)]);
  const creatorSigner = await ethers.getSigner(creator);
  if ((await T(creatorSigner).balanceOf(creator)) === 0n) await buy(creatorSigner, '0.002');

  // a token PRISM doesn't list
  const fake = await ethers.deployContract('MockERC20', ['Totally Real', 'REAL', 18]);
  await (await fake.mint(s[10]!.address, ethers.parseEther('1000000'))).wait();

  // usernames (PrismProfiles, on the fork)
  await (await new ethers.Contract(PROFILES, profilesAbi, s[1]!).setProfile('steady_holder', 0, 'In for the long run.', '')).wait();
  await (await new ethers.Contract(PROFILES, profilesAbi, s[4]!).setProfile('ladder_climber', 0, '', '')).wait();
  await (await new ethers.Contract(PROFILES, profilesAbi, s[5]!).setProfile('dip_and_back', 0, '', '')).wait();

  const ids: Record<string, number> = {};
  ids.holder = await post(s[1]!, token, 5, `Clean curve, active creator. Holding ${symbol} to graduation.`);
  ids.holder2 = await post(s[2]!, token, 4, 'Good start. Tax split goes to holders, which I like.');
  ids.trimmer = await post(s[3]!, token, 4, 'Solid, but I took a little profit.');
  ids.ladder1 = await post(s[4]!, token, 5, 'Never selling. Diamond hands 💎');
  ids.dipper = await post(s[5]!, token, 5, 'Long-term hold.');
  ids.marked = await post(s[6]!, token, 5, 'This is the one. 100x incoming.');
  ids.dust = await post(s[7]!, token, 5, 'Tiny bag, big love.');
  ids.selfMark = await post(s[8]!, token, 5, 'In it for the tech.');
  ids.creator = await post(creatorSigner, token, 5, 'Built with love. Best launch on the chain.');
  ids.unlisted = await post(s[10]!, await fake.getAddress(), 5, 'Totally real token, best rep farm.');
  ids.aapl = await post(s[1]!, AAPL, 4, 'Steady test stock. Nice to have something boring.');
  ids.aapl2 = await post(s[2]!, AAPL, 3, 'Fine for a test stock.');

  // 8 days on: these positions are decided (kept a week)
  await wait(8 * 24 * HOUR);

  await sellTo(s[3]!, 70n); // trimmed 30%
  // the ladder: sell to 60%, update (baseline stays), sell to 35% of the first balance, update: SOLD
  const ladderStart = await balance(s[4]!);
  await sellTo(s[4]!, 60n);
  ids.ladder2 = await post(s[4]!, token, 5, 'Still holding most of it.');
  await wait(HOUR);
  await sellTo(s[4]!, 35n, ladderStart);
  ids.ladder3 = await post(s[4]!, token, 5, 'Trust me, still in.');
  // dump below half, buy back above before anyone marks it
  const dipStart = await balance(s[5]!);
  await sellTo(s[5]!, 20n);
  await buy(s[5]!, '0.004');
  // a seller marked by someone else (truth keeper), and one who marks their own sale
  await sellTo(s[6]!, 0n);
  await (await reviews.connect(s[2]!).getFunction('markSold')(ids.marked)).wait();
  await sellTo(s[8]!, 0n);
  await (await reviews.connect(s[8]!).getFunction('markSold')(ids.selfMark)).wait();

  const chainNow = (await ethers.provider.getBlock('latest'))!.timestamp;
  console.log(
    JSON.stringify(
      {
        prismReviews: await reviews.getAddress(),
        prismReviewsTx: deployTx.hash,
        prismReviewsFromBlock: deployReceipt.blockNumber,
        firstId: Number(firstId),
        token,
        symbol,
        creator,
        unlistedToken: await fake.getAddress(),
        ids,
        accounts: { holder: s[1]!.address, ladder: s[4]!.address, dipper: s[5]!.address, dust: s[7]!.address, selfMarker: s[8]!.address, truthKeeper: s[2]!.address, unlisted: s[10]!.address, holderNoReview: s[9]!.address },
        dip: { start: dipStart.toString(), now: (await balance(s[5]!)).toString() },
        clockOffsetMs: (chainNow - Math.floor(Date.now() / 1000)) * 1000,
        block: await ethers.provider.getBlockNumber(),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
