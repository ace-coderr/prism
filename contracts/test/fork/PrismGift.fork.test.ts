/**
 * Fork test: a gift on Robinhood Chain Testnet at its latest block (`npm run test:fork`).
 * With the REAL PrismCrystal (0x59ce…9f40) and its real crystal #2 (its owner impersonated),
 * the app's gift flow: seal first, then safeTransferFrom(from, to, id, note), and read the
 * note back from the transaction with the app's own reader (packages/core gifts.ts).
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';

const FORK = process.env.FORK === '1';
const PRISM_CRYSTAL = '0x59ce49dE3782FA87E94850b23FEB1457009f9f40';
const ID = 2n;
const abi = [
  'function ownerOf(uint256) view returns (address)',
  'function seal(uint256 id, uint64 unlockTime)',
  'function sealedUntil(uint256) view returns (uint64)',
  'function isSealed(uint256) view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, bytes data)',
  'function withdrawAllAndBurn(uint256 id, address to)',
  'event Sealed(uint256 indexed id, uint64 unlockTime)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'error CrystalSealed(uint64 unlockTime)',
];

/** The app's note reader (core is an ES module, so it runs in a child process with tsx). */
function appNote(input: string, from: string, to: string, id: bigint): string | null {
  const tsx = require.resolve('tsx/cli');
  const code = `import { noteFromInput } from '@prism/core';
process.stdout.write(JSON.stringify(noteFromInput(${JSON.stringify(input)}, { from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, id: ${id}n })));`;
  return JSON.parse(execFileSync(process.execPath, [tsx, '--eval', code], { cwd: join(__dirname, '../../..') }).toString());
}

async function impersonate(address: string) {
  await network.provider.request({ method: 'hardhat_impersonateAccount', params: [address] });
  await network.provider.send('hardhat_setBalance', [address, '0x56BC75E2D63100000']); // 100 ETH for gas
  return ethers.getSigner(address);
}

(FORK ? describe : describe.skip)('Gift on a fork of Robinhood Chain Testnet', function () {
  this.timeout(300_000);

  // calls at the fork block itself count as "historical" (no hardfork history for 46630): move one block on
  before(() => network.provider.send('evm_mine'));

  it('seals, then sends with a UTF-8 note, and the note reads back from the transaction', async () => {
    const crystal = new ethers.Contract(PRISM_CRYSTAL, abi, ethers.provider);
    const owner: string = await crystal.ownerOf(ID);
    const signer = await impersonate(owner);
    const friend = ethers.Wallet.createRandom().address;
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    const unlock = BigInt(now + 3 * 86400);
    const note = 'Happy birthday! 🎁🔮 Open it in three days';

    // Seal 1/2, while it's still ours…
    await expect(crystal.connect(signer).getFunction('seal')(ID, unlock)).to.emit(crystal, 'Sealed').withArgs(ID, unlock);
    // …then Send 2/2, with the note as the transfer's data
    const send = await crystal.connect(signer).getFunction('safeTransferFrom')(owner, friend, ID, ethers.toUtf8Bytes(note));
    const receipt = (await send.wait())!;

    expect(await crystal.ownerOf(ID)).to.equal(friend);
    // the seal goes with the gift
    expect(await crystal.sealedUntil(ID)).to.equal(unlock);
    expect(await crystal.isSealed(ID)).to.equal(true);

    // nothing stores or emits the note: there's only the Transfer event, whose transaction carries it
    const transfer = receipt.logs.map((l) => crystal.interface.parseLog(l)).find((l) => l?.name === 'Transfer');
    expect(transfer!.args.from).to.equal(owner);
    expect(transfer!.args.to).to.equal(friend);
    const tx = (await ethers.provider.getTransaction(transfer!.transactionHash ?? receipt.hash))!;
    const [, , , data] = crystal.interface.decodeFunctionData('safeTransferFrom', tx.data);
    expect(ethers.toUtf8String(data)).to.equal(note);
    // and the app's reader finds exactly that note (and none for the wrong crystal)
    expect(appNote(tx.data, owner, friend, ID)).to.equal(note);
    expect(appNote(tx.data, owner, friend, ID + 1n)).to.equal(null);

    // sealed: not even the new owner can take anything out before the date
    const them = await impersonate(friend);
    await expect(crystal.connect(them).getFunction('withdrawAllAndBurn')(ID, friend)).to.be.revertedWithCustomError(crystal, 'CrystalSealed');
  });
});
