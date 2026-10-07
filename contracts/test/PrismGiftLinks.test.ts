import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import type { PrismCrystal, PrismGiftLinks } from '../typechain-types';

const E = (n: string | number) => ethers.parseEther(String(n));
const coder = ethers.AbiCoder.defaultAbiCoder();
/** The `data` the app sends with safeTransferFrom to create a link. */
const linkData = (claimKey: string, expiry: bigint | number, note = '') => coder.encode(['address', 'uint64', 'string'], [claimKey, expiry, note]);
const DAY = 86_400;

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const crystal = (await ethers.deployContract('PrismCrystal')) as unknown as PrismCrystal;
  const links = (await ethers.deployContract('PrismGiftLinks', [await crystal.getAddress()])) as unknown as PrismGiftLinks;
  // ETH-only crystals: #1, #2 for alice, #3 for bob
  await crystal.connect(alice).forge([], [], { value: E('0.01') });
  await crystal.connect(alice).forge([], [], { value: E('0.02') });
  await crystal.connect(bob).forge([], [], { value: E('0.01') });
  // a fresh one-time claim key, funded with a little ETH for its own gas (as the app does)
  const claimKey = ethers.Wallet.createRandom().connect(ethers.provider);
  await alice.sendTransaction({ to: claimKey.address, value: E('0.0005') });
  const linksAddr = await links.getAddress();
  /** alice gifts crystal `id` as a link that lasts `days` days */
  const createLink = async (id = 1n, days = 7, note = 'for you', key = claimKey.address) =>
    crystal
      .connect(alice)
      ['safeTransferFrom(address,address,uint256,bytes)'](alice.address, linksAddr, id, linkData(key, (await time.latest()) + days * DAY, note));
  return { crystal, links, linksAddr, alice, bob, carol, claimKey, createLink };
}

describe('PrismGiftLinks', () => {
  it('needs a crystal collection to point at', async () => {
    await expect(ethers.deployContract('PrismGiftLinks', [ethers.ZeroAddress])).to.be.revertedWithCustomError(
      await ethers.getContractFactory('PrismGiftLinks'),
      'ZeroAddress',
    );
  });

  describe('create', () => {
    it('one safeTransferFrom with the link data creates the link and holds the crystal', async () => {
      const { crystal, links, linksAddr, alice, claimKey, createLink } = await loadFixture(deploy);
      const expiry = (await time.latest()) + 7 * DAY; // createLink reads the same latest block
      await expect(createLink(1n, 7, 'happy birthday 🎁'))
        .to.emit(links, 'LinkCreated')
        .withArgs(1n, alice.address, 1n, claimKey.address, expiry, 'happy birthday 🎁');
      expect(await crystal.ownerOf(1n)).to.equal(linksAddr);
      expect(await links.linkCount()).to.equal(1n);
      const l = await links.getLink(1n);
      expect([l.sender, l.expiry, l.status, l.claimKey, l.claimedBy, l.crystalId]).to.deep.equal([
        alice.address,
        BigInt(expiry),
        1n, // Open
        claimKey.address,
        ethers.ZeroAddress,
        1n,
      ]);
      expect(await links.statusOf(1n)).to.equal(1n);
    });

    it('refuses crystals of another collection, direct calls and transfers without link data', async () => {
      const { links, linksAddr, alice, claimKey, crystal } = await loadFixture(deploy);
      const other = await ethers.deployContract('PrismCrystal');
      await other.connect(alice).forge([], [], { value: E('0.01') });
      const data = linkData(claimKey.address, (await time.latest()) + DAY);
      await expect(other.connect(alice)['safeTransferFrom(address,address,uint256,bytes)'](alice.address, linksAddr, 1n, data)).to.be.revertedWithCustomError(
        links,
        'NotCrystal',
      );
      await expect(links.connect(alice).onERC721Received(alice.address, alice.address, 1n, data)).to.be.revertedWithCustomError(links, 'NotCrystal');
      await expect(crystal.connect(alice)['safeTransferFrom(address,address,uint256)'](alice.address, linksAddr, 1n)).to.be.revertedWithCustomError(
        links,
        'NoLinkData',
      );
    });

    it('checks the claim key, the expiry (future, at most a year) and the note length', async () => {
      const { links, linksAddr, alice, claimKey, crystal } = await loadFixture(deploy);
      const now = await time.latest();
      const send = (data: string) => crystal.connect(alice)['safeTransferFrom(address,address,uint256,bytes)'](alice.address, linksAddr, 1n, data);
      await expect(send(linkData(ethers.ZeroAddress, now + DAY))).to.be.revertedWithCustomError(links, 'BadClaimKey');
      await expect(send(linkData(linksAddr, now + DAY))).to.be.revertedWithCustomError(links, 'BadClaimKey');
      await expect(send(linkData(claimKey.address, now))).to.be.revertedWithCustomError(links, 'BadExpiry');
      await expect(send(linkData(claimKey.address, now + 366 * DAY))).to.be.revertedWithCustomError(links, 'BadExpiry');
      await expect(send(linkData(claimKey.address, now + DAY, 'x'.repeat(561)))).to.be.revertedWithCustomError(links, 'NoteTooLong');
      await expect(send('0x1234')).to.be.reverted; // not abi-encoded link data
      // 140 emoji (4 bytes each) fit exactly
      await expect(send(linkData(claimKey.address, now + DAY, '🎁'.repeat(140)))).to.emit(links, 'LinkCreated');
    });

    it('a link made by an approved operator belongs to the crystal’s owner', async () => {
      const { crystal, links, linksAddr, alice, carol, claimKey } = await loadFixture(deploy);
      await crystal.connect(alice).approve(carol.address, 2n);
      await crystal
        .connect(carol)
        ['safeTransferFrom(address,address,uint256,bytes)'](alice.address, linksAddr, 2n, linkData(claimKey.address, (await time.latest()) + DAY));
      expect((await links.getLink(1n)).sender).to.equal(alice.address);
      await expect(links.connect(carol).cancel(1n)).to.be.revertedWithCustomError(links, 'NotSender');
    });
  });

  describe('claim', () => {
    it('the claim key sends the crystal to whoever it names, paying its own gas', async () => {
      const { crystal, links, carol, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      await expect(links.connect(claimKey).claim(1n, carol.address)).to.emit(links, 'LinkClaimed').withArgs(1n, carol.address, 1n);
      expect(await crystal.ownerOf(1n)).to.equal(carol.address);
      const l = await links.getLink(1n);
      expect([l.status, l.claimedBy]).to.deep.equal([2n, carol.address]); // Claimed
      expect(await links.statusOf(1n)).to.equal(2n);
      expect(await ethers.provider.getBalance(claimKey.address)).to.be.gt(0n); // leftover for the app to sweep
    });

    it('only the claim key can claim: not the sender, not the recipient, not anyone else', async () => {
      const { links, alice, bob, carol, createLink } = await loadFixture(deploy);
      await createLink();
      for (const who of [alice, bob, carol]) {
        await expect(links.connect(who).claim(1n, who.address)).to.be.revertedWithCustomError(links, 'NotClaimKey');
      }
    });

    it('claims once: a second claim (or a claim after cancel) is refused', async () => {
      const { links, bob, carol, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      await links.connect(claimKey).claim(1n, carol.address);
      await expect(links.connect(claimKey).claim(1n, bob.address)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(1n, 2n);
      await expect(links.connect(claimKey).claim(9n, bob.address)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(9n, 0n);
    });

    it('expires: no claim from the expiry on, the sender can still take it back', async () => {
      const { crystal, links, alice, carol, claimKey, createLink } = await loadFixture(deploy);
      await createLink(1n, 1);
      const { expiry } = await links.getLink(1n);
      await time.increaseTo(expiry);
      expect(await links.statusOf(1n)).to.equal(4n); // Expired
      await expect(links.connect(claimKey).claim(1n, carol.address)).to.be.revertedWithCustomError(links, 'LinkExpired').withArgs(expiry);
      await expect(links.connect(alice).cancel(1n)).to.emit(links, 'LinkCancelled').withArgs(1n, alice.address, 1n);
      expect(await crystal.ownerOf(1n)).to.equal(alice.address);
    });

    it('refuses the zero address and the links contract as recipient', async () => {
      const { links, linksAddr, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      await expect(links.connect(claimKey).claim(1n, ethers.ZeroAddress)).to.be.revertedWithCustomError(links, 'BadRecipient');
      await expect(links.connect(claimKey).claim(1n, linksAddr)).to.be.revertedWithCustomError(links, 'BadRecipient');
    });

    it('a recipient contract that can’t hold NFTs makes the claim revert, and the link stays open', async () => {
      const { crystal, links, carol, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      const token = await ethers.deployContract('MockERC20', ['No NFTs', 'NO', 18]); // has no onERC721Received
      await expect(links.connect(claimKey).claim(1n, await token.getAddress())).to.be.revertedWithCustomError(crystal, 'ERC721InvalidReceiver');
      expect(await links.statusOf(1n)).to.equal(1n);
      await links.connect(claimKey).claim(1n, carol.address);
      expect(await crystal.ownerOf(1n)).to.equal(carol.address);
    });
  });

  describe('cancel', () => {
    it('the sender takes the crystal back while unclaimed; nobody else can', async () => {
      const { crystal, links, alice, bob, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      await expect(links.connect(bob).cancel(1n)).to.be.revertedWithCustomError(links, 'NotSender');
      await expect(links.connect(claimKey).cancel(1n)).to.be.revertedWithCustomError(links, 'NotSender');
      await expect(links.connect(alice).cancel(1n)).to.emit(links, 'LinkCancelled').withArgs(1n, alice.address, 1n);
      expect(await crystal.ownerOf(1n)).to.equal(alice.address);
      expect(await links.statusOf(1n)).to.equal(3n); // Cancelled
      await expect(links.connect(alice).cancel(1n)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(1n, 3n);
      await expect(links.connect(claimKey).claim(1n, bob.address)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(1n, 3n);
    });

    it('cannot cancel after the claim', async () => {
      const { crystal, links, alice, carol, claimKey, createLink } = await loadFixture(deploy);
      await createLink();
      await links.connect(claimKey).claim(1n, carol.address);
      await expect(links.connect(alice).cancel(1n)).to.be.revertedWithCustomError(links, 'NotOpen').withArgs(1n, 2n);
      expect(await crystal.ownerOf(1n)).to.equal(carol.address);
    });
  });

  describe('sealed crystals', () => {
    it('can be gift-linked: the seal travels with the crystal and the recipient waits for it', async () => {
      const { crystal, links, alice, carol, claimKey, createLink } = await loadFixture(deploy);
      const unlock = (await time.latest()) + 3 * DAY;
      await crystal.connect(alice).seal(2n, unlock);
      await createLink(2n);
      await links.connect(claimKey).claim(1n, carol.address);
      expect(await crystal.ownerOf(2n)).to.equal(carol.address);
      expect(await crystal.isSealed(2n)).to.equal(true);
      await expect(crystal.connect(carol).withdraw(2n, [], [], E('0.02'), carol.address)).to.be.revertedWithCustomError(crystal, 'CrystalSealed');
      await time.increaseTo(unlock);
      await expect(crystal.connect(carol).withdraw(2n, [], [], E('0.02'), carol.address)).to.changeEtherBalance(carol, E('0.02'));
    });

    it('a sealed crystal can be cancelled back to the sender, still sealed', async () => {
      const { crystal, links, alice, createLink } = await loadFixture(deploy);
      await crystal.connect(alice).seal(2n, (await time.latest()) + 3 * DAY);
      await createLink(2n);
      await links.connect(alice).cancel(1n);
      expect(await crystal.ownerOf(2n)).to.equal(alice.address);
      expect(await crystal.isSealed(2n)).to.equal(true);
    });
  });

  describe('re-entrancy', () => {
    async function withAttacker() {
      const f = await deploy();
      const attacker = await ethers.deployContract('GiftLinkAttacker', [f.linksAddr, await f.crystal.getAddress()]);
      const at = await attacker.getAddress();
      const expiry = (await time.latest()) + 7 * DAY;
      // links 1 and 2: alice's crystals #1 and #2, both claimable by the attacker contract
      for (const id of [1n, 2n]) {
        await f.crystal.connect(f.alice)['safeTransferFrom(address,address,uint256,bytes)'](f.alice.address, f.linksAddr, id, linkData(at, expiry));
      }
      return { ...f, attacker, at, expiry };
    }

    it('a recipient cannot claim another link from inside the transfer', async () => {
      const { links, attacker, crystal, linksAddr } = await withAttacker();
      await attacker.arm(1, 2n, '0x');
      await expect(attacker.claim(1n)).to.be.revertedWithCustomError(links, 'ReentrancyGuardReentrantCall');
      expect(await crystal.ownerOf(1n)).to.equal(linksAddr);
      expect(await crystal.ownerOf(2n)).to.equal(linksAddr);
    });

    it('a sender cannot cancel another link from inside the transfer', async () => {
      const { links, attacker, crystal, linksAddr, expiry } = await withAttacker();
      // the attacker sends two crystals as links of its own
      const a = await attacker.forgeEth.staticCall({ value: E('0.01') });
      await attacker.forgeEth({ value: E('0.01') });
      await attacker.forgeEth({ value: E('0.01') });
      const keyData = linkData(ethers.Wallet.createRandom().address, expiry);
      await attacker.deposit(a, keyData); // link 3
      await attacker.deposit(a + 1n, keyData); // link 4
      await attacker.arm(2, 4n, '0x');
      await expect(attacker.cancel(3n)).to.be.revertedWithCustomError(links, 'ReentrancyGuardReentrantCall');
      expect(await crystal.ownerOf(a)).to.equal(linksAddr);
    });

    it('a recipient cannot create a new link from inside the transfer', async () => {
      const { links, attacker, crystal, linksAddr, expiry } = await withAttacker();
      const mine = await attacker.forgeEth.staticCall({ value: E('0.01') });
      await attacker.forgeEth({ value: E('0.01') });
      await attacker.arm(3, mine, linkData(ethers.Wallet.createRandom().address, expiry));
      await expect(attacker.claim(1n)).to.be.revertedWithCustomError(links, 'ReentrancyGuardReentrantCall');
      expect(await crystal.ownerOf(1n)).to.equal(linksAddr);
      expect(await links.linkCount()).to.equal(2n);
    });
  });

  it('packages/core/src/abi/prismGiftLinks.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(readFileSync(path.join(__dirname, '../artifacts/contracts/PrismGiftLinks.sol/PrismGiftLinks.json'), 'utf8'));
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismGiftLinks.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismGiftLinksAbi = ') + 'prismGiftLinksAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismGiftLinksBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});
