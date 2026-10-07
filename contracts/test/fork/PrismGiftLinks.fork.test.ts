/**
 * Fork test: gift links on Robinhood Chain Testnet at its latest block (`npm run test:fork`).
 * PrismGiftLinks is deployed on the fork against the REAL PrismCrystal (0x59ce…9f40); whoever
 * holds the real crystals #1–#3 at that point (impersonated) sends them as links built with the app's own
 * code (packages/core giftLinks.ts), and a fresh one-time claim key claims and sweeps its gas
 * money to the recipient, as the /claim page does.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import type { PrismGiftLinks } from '../../typechain-types';

const FORK = process.env.FORK === '1';
const E = (n: string | number) => ethers.parseEther(String(n));
const PRISM_CRYSTAL = '0x59ce49dE3782FA87E94850b23FEB1457009f9f40';
const crystalAbi = [
  'function ownerOf(uint256) view returns (address)',
  'function seal(uint256 id, uint64 unlockTime)',
  'function isSealed(uint256) view returns (bool)',
  'function holdings(uint256) view returns (address[] tokens, uint256[] balances, uint256 eth)',
  'function safeTransferFrom(address from, address to, uint256 id, bytes data)',
];

/** Run a snippet of the app's core (an ES module) in a child process with tsx; it prints JSON. */
function app<T>(code: string): T {
  const tsx = require.resolve('tsx/cli');
  return JSON.parse(execFileSync(process.execPath, [tsx, '--eval', code], { cwd: join(__dirname, '../../..') }).toString());
}
/** The app's link data: abi.encode(claimKey, expiry, note). */
const appLinkData = (claimKey: string, expiry: number, note: string) =>
  app<string>(`import { linkData } from '@prism/core';
process.stdout.write(JSON.stringify(linkData(${JSON.stringify(claimKey)}, ${expiry}, ${JSON.stringify(note)})));`);

(FORK ? describe : describe.skip)('PrismGiftLinks on a fork of Robinhood Chain Testnet', function () {
  this.timeout(600_000);
  let links: PrismGiftLinks;
  let linksAddr: string;
  type Signer = Awaited<ReturnType<typeof ethers.getSigner>>;
  const crystal = (signer?: Signer) => new ethers.Contract(PRISM_CRYSTAL, crystalAbi, signer ?? ethers.provider);

  /** Whoever holds crystal `id` right now (other fork tests in the same run may have moved it), impersonated. */
  async function holder(id: bigint): Promise<Signer> {
    const who = (await crystal().ownerOf(id)) as string;
    await network.provider.request({ method: 'hardhat_impersonateAccount', params: [who] });
    await network.provider.send('hardhat_setBalance', [who, '0x56BC75E2D63100000']);
    return ethers.getSigner(who);
  }

  async function link(id: bigint, note: string) {
    const from = await holder(id);
    const key = ethers.Wallet.createRandom().connect(ethers.provider);
    const { timestamp } = (await ethers.provider.getBlock('latest'))!;
    const tx = await crystal(from).safeTransferFrom(from.address, linksAddr, id, appLinkData(key.address, timestamp + 30 * 86_400, note));
    const rc = (await tx.wait())!;
    const ev = rc.logs.map((l: { topics: string[]; data: string }) => { try { return links.interface.parseLog(l); } catch { return null; } }).find((p: { name?: string } | null) => p?.name === 'LinkCreated')!;
    expect(ev.args.sender).to.equal(from.address);
    await (await from.sendTransaction({ to: key.address, value: E('0.0005') })).wait(); // gas money for the claim
    return { from, key, linkId: ev.args.linkId as bigint, note: ev.args.note as string };
  }

  before(async () => {
    await network.provider.send('evm_mine'); // a local block first: the fork's own block has no known hardfork
    expect((await ethers.provider.getNetwork()).chainId).to.equal(46630n);
    links = (await ethers.deployContract('PrismGiftLinks', [PRISM_CRYSTAL])) as unknown as PrismGiftLinks;
    linksAddr = await links.getAddress();
  });

  it('sends the real crystal #2 as a link (app-built data), claimed by its one-time key, gas money swept to the recipient', async () => {
    const before = await crystal().holdings(2n);
    const { key, linkId, note } = await link(2n, 'welcome to PRISM 🎁');
    expect(note).to.equal('welcome to PRISM 🎁');
    expect(await crystal().ownerOf(2n)).to.equal(linksAddr);

    const recipient = ethers.Wallet.createRandom().address; // a brand-new user, 0 ETH
    await expect(links.connect(key).claim(linkId, recipient)).to.emit(links, 'LinkClaimed').withArgs(linkId, recipient, 2n);
    expect(await crystal().ownerOf(2n)).to.equal(recipient);
    const after = await crystal().holdings(2n);
    expect([...after.balances]).to.deep.equal([...before.balances]); // the basket moved with it, untouched

    // sweep, as the claim page does: estimate × 1.5 at a fixed legacy gas price, value from the app's sweepValue
    const balance = await ethers.provider.getBalance(key.address);
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice!;
    const gas = ((await ethers.provider.estimateGas({ from: key.address, to: recipient, value: 1n })) * 3n) / 2n;
    const value = BigInt(
      app<string>(`import { sweepValue } from '@prism/core';
process.stdout.write(JSON.stringify(String(sweepValue(${balance}n, ${gas}n, ${gasPrice}n))));`),
    );
    expect(value).to.be.gt(0n);
    await (await key.sendTransaction({ to: recipient, value, gasLimit: gas, gasPrice, type: 0 })).wait();
    expect(await ethers.provider.getBalance(recipient)).to.equal(value);
    expect(await ethers.provider.getBalance(key.address)).to.be.lt(E('0.00005')); // only the unused gas reserve is left
    console.log(`      recipient got crystal #2 + ${ethers.formatEther(value)} ETH (claim key paid both fees)`);
  });

  it('a sealed real crystal (#1) stays sealed through the link and the claim', async () => {
    const { timestamp } = (await ethers.provider.getBlock('latest'))!;
    await (await crystal(await holder(1n)).seal(1n, timestamp + 3 * 86_400)).wait();
    const { key, linkId } = await link(1n, '');
    const recipient = ethers.Wallet.createRandom().address;
    await (await links.connect(key).claim(linkId, recipient)).wait();
    expect(await crystal().ownerOf(1n)).to.equal(recipient);
    expect(await crystal().isSealed(1n)).to.equal(true);
  });

  it('the sender cancels a waiting link (#3) and gets the real crystal back; the key can no longer claim', async () => {
    const { from, key, linkId } = await link(3n, 'maybe later');
    await expect(links.connect(from).cancel(linkId)).to.emit(links, 'LinkCancelled').withArgs(linkId, from.address, 3n);
    expect(await crystal().ownerOf(3n)).to.equal(from.address);
    await expect(links.connect(key).claim(linkId, key.address)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(linkId, 3n);
  });
});
