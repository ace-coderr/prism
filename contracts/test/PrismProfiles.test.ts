import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

const E = (n: string | number) => ethers.parseEther(String(n));

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const crystal = await ethers.deployContract('PrismCrystal');
  const profiles = await ethers.deployContract('PrismProfiles', [await crystal.getAddress()]);
  // ETH-only crystals: #1 and #2 for alice, #3 for bob
  await crystal.connect(alice).forge([], [], { value: E('0.01') });
  await crystal.connect(alice).forge([], [], { value: E('0.01') });
  await crystal.connect(bob).forge([], [], { value: E('0.01') });
  return { crystal, profiles, alice, bob, carol };
}

describe('PrismProfiles', () => {
  it('needs a crystal collection to point at', async () => {
    await expect(ethers.deployContract('PrismProfiles', [ethers.ZeroAddress])).to.be.revertedWithCustomError(
      await ethers.getContractFactory('PrismProfiles'),
      'ZeroAddress',
    );
  });

  describe('names', () => {
    it('accepts 3–20 characters of a–z, 0–9 and underscore', async () => {
      const { profiles } = await loadFixture(deploy);
      for (const ok of ['ace', 'abc_123', 'a_b', '000', 'x'.repeat(20), 'under_score_']) {
        expect(await profiles.isValidName(ok), ok).to.equal(true);
      }
    });

    it('refuses too short, too long, uppercase, spaces, symbols and non-ASCII', async () => {
      const { profiles } = await loadFixture(deploy);
      for (const bad of ['', 'ab', 'x'.repeat(21), 'Ace', 'ACE', 'a b', 'a-b', 'a.b', 'é_ab', 'ace!', 'ａｂｃ', 'ab\u0000']) {
        expect(await profiles.isValidName(bad), JSON.stringify(bad)).to.equal(false);
        await expect(profiles.setName(bad)).to.be.revertedWithCustomError(profiles, 'InvalidName');
      }
    });

    it('sets a name, with lookups both ways and an event', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).setName('ace')).to.emit(profiles, 'NameSet').withArgs(alice.address, 'ace');
      expect(await profiles.nameOf(alice.address)).to.equal('ace');
      expect(await profiles.addressOfName('ace')).to.equal(alice.address);
      expect((await profiles.profileOf(alice.address)).name).to.equal('ace');
      expect(await profiles.addressOfName('nobody')).to.equal(ethers.ZeroAddress);
    });

    it('is unique, first come first served', async () => {
      const { profiles, alice, bob } = await loadFixture(deploy);
      await profiles.connect(alice).setName('ace');
      await expect(profiles.connect(bob).setName('ace')).to.be.revertedWithCustomError(profiles, 'NameTaken').withArgs(alice.address);
      await expect(profiles.connect(alice).setName('ace')).to.be.revertedWithCustomError(profiles, 'AlreadyYours');
    });

    it('renaming releases the old name for anyone', async () => {
      const { profiles, alice, bob } = await loadFixture(deploy);
      await profiles.connect(alice).setName('ace');
      await expect(profiles.connect(alice).setName('ace_two'))
        .to.emit(profiles, 'NameCleared')
        .withArgs(alice.address, 'ace')
        .and.to.emit(profiles, 'NameSet')
        .withArgs(alice.address, 'ace_two');
      expect(await profiles.addressOfName('ace')).to.equal(ethers.ZeroAddress);
      await profiles.connect(bob).setName('ace');
      expect(await profiles.addressOfName('ace')).to.equal(bob.address);
    });

    it('clearName frees the name; clearing with no name reverts', async () => {
      const { profiles, alice, bob } = await loadFixture(deploy);
      await expect(profiles.connect(alice).clearName()).to.be.revertedWithCustomError(profiles, 'NoName');
      await profiles.connect(alice).setName('ace');
      await expect(profiles.connect(alice).clearName()).to.emit(profiles, 'NameCleared').withArgs(alice.address, 'ace');
      expect(await profiles.nameOf(alice.address)).to.equal('');
      await profiles.connect(bob).setName('ace');
      expect(await profiles.nameOf(bob.address)).to.equal('ace');
    });
  });

  describe('avatar', () => {
    it('can only be set to a crystal the caller owns right now', async () => {
      const { profiles, alice, bob } = await loadFixture(deploy);
      await expect(profiles.connect(alice).setAvatar(1)).to.emit(profiles, 'AvatarSet').withArgs(alice.address, 1n);
      expect(await profiles.avatarOf(alice.address)).to.equal(1n);
      await expect(profiles.connect(alice).setAvatar(3)).to.be.revertedWithCustomError(profiles, 'NotCrystalOwner').withArgs(3n);
      await expect(profiles.connect(bob).setAvatar(1)).to.be.revertedWithCustomError(profiles, 'NotCrystalOwner').withArgs(1n);
      // never minted, and id 0
      await expect(profiles.connect(alice).setAvatar(99)).to.be.revertedWithCustomError(profiles, 'NotCrystalOwner').withArgs(99n);
      await expect(profiles.connect(alice).setAvatar(0)).to.be.revertedWithCustomError(profiles, 'NotCrystalOwner').withArgs(0n);
    });

    it('stops counting once the crystal is transferred, and the new owner can use it', async () => {
      const { crystal, profiles, alice, bob } = await loadFixture(deploy);
      await profiles.connect(alice).setAvatar(1);
      await crystal.connect(alice).transferFrom(alice.address, bob.address, 1);
      expect(await profiles.avatarOf(alice.address)).to.equal(0n);
      expect((await profiles.profileOf(alice.address)).avatarId).to.equal(0n);
      await profiles.connect(bob).setAvatar(1);
      expect(await profiles.avatarOf(bob.address)).to.equal(1n);
      // if it comes back, alice's stored choice applies again (and bob's no longer does)
      await crystal.connect(bob).transferFrom(bob.address, alice.address, 1);
      expect(await profiles.avatarOf(alice.address)).to.equal(1n);
      expect(await profiles.avatarOf(bob.address)).to.equal(0n);
    });

    it('stops counting once the crystal is burned', async () => {
      const { crystal, profiles, alice } = await loadFixture(deploy);
      await profiles.connect(alice).setAvatar(2);
      await crystal.connect(alice).withdrawAllAndBurn(2, alice.address);
      expect(await profiles.avatarOf(alice.address)).to.equal(0n);
      expect((await profiles.profileOf(alice.address)).avatarId).to.equal(0n);
    });

    it('clearAvatar removes it; clearing with none reverts', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).clearAvatar()).to.be.revertedWithCustomError(profiles, 'NoAvatar');
      await profiles.connect(alice).setAvatar(1);
      await expect(profiles.connect(alice).clearAvatar()).to.emit(profiles, 'AvatarCleared').withArgs(alice.address);
      expect(await profiles.avatarOf(alice.address)).to.equal(0n);
    });
  });

  describe('bio', () => {
    it('allows up to 120 bytes of text, counted in bytes', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).setBio('Collecting crystals.')).to.emit(profiles, 'BioSet').withArgs(alice.address, 'Collecting crystals.');
      await profiles.connect(alice).setBio('x'.repeat(120));
      await profiles.connect(alice).setBio('é'.repeat(60)); // 2 bytes each = 120
      await expect(profiles.connect(alice).setBio('x'.repeat(121))).to.be.revertedWithCustomError(profiles, 'InvalidBio');
      await expect(profiles.connect(alice).setBio('é'.repeat(61))).to.be.revertedWithCustomError(profiles, 'InvalidBio');
      expect((await profiles.profileOf(alice.address)).bio).to.equal('é'.repeat(60));
    });

    it('refuses an empty bio and control characters', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      for (const bad of ['', 'line\nbreak', 'tab\there', 'nul\u0000', 'del\u007f']) {
        await expect(profiles.connect(alice).setBio(bad), JSON.stringify(bad)).to.be.revertedWithCustomError(profiles, 'InvalidBio');
      }
    });

    it('clearBio removes it; clearing with none reverts', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).clearBio()).to.be.revertedWithCustomError(profiles, 'NoBio');
      await profiles.connect(alice).setBio('hi there');
      await expect(profiles.connect(alice).clearBio()).to.emit(profiles, 'BioCleared').withArgs(alice.address);
      expect((await profiles.profileOf(alice.address)).bio).to.equal('');
    });
  });

  describe('X handle', () => {
    it('accepts 1–15 characters of a–z, A–Z, 0–9 and underscore', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      for (const ok of ['a', '_ace_won', 'Ace_Won1', 'x'.repeat(15)]) expect(await profiles.isValidX(ok), ok).to.equal(true);
      await expect(profiles.connect(alice).setX('_ace_won')).to.emit(profiles, 'XSet').withArgs(alice.address, '_ace_won');
      expect((await profiles.profileOf(alice.address)).x).to.equal('_ace_won');
    });

    it('refuses empty, too long, @, links, spaces and symbols', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      for (const bad of ['', 'x'.repeat(16), '@ace', 'x.com/ace', 'https://x.com', 'a b', 'a-b', 'é']) {
        expect(await profiles.isValidX(bad), bad).to.equal(false);
        await expect(profiles.connect(alice).setX(bad)).to.be.revertedWithCustomError(profiles, 'InvalidX');
      }
    });

    it('clearX removes it; clearing with none reverts', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).clearX()).to.be.revertedWithCustomError(profiles, 'NoX');
      await profiles.connect(alice).setX('ace');
      await expect(profiles.connect(alice).clearX()).to.emit(profiles, 'XCleared').withArgs(alice.address);
      expect((await profiles.profileOf(alice.address)).x).to.equal('');
    });
  });

  describe('setProfile', () => {
    it('sets every field in one transaction, with an event for each', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).setProfile('ace', 1, 'Hello.', '_ace_won'))
        .to.emit(profiles, 'NameSet')
        .withArgs(alice.address, 'ace')
        .and.to.emit(profiles, 'AvatarSet')
        .withArgs(alice.address, 1n)
        .and.to.emit(profiles, 'BioSet')
        .withArgs(alice.address, 'Hello.')
        .and.to.emit(profiles, 'XSet')
        .withArgs(alice.address, '_ace_won');
      const p = await profiles.profileOf(alice.address);
      expect([p.name, p.avatarId, p.bio, p.x]).to.deep.equal(['ace', 1n, 'Hello.', '_ace_won']);
    });

    it('leaves empty values unchanged, and keeping the same name is not an error', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await profiles.connect(alice).setProfile('ace', 1, 'Hello.', '_ace_won');
      const tx = profiles.connect(alice).setProfile('ace', 0, 'New bio.', '');
      await expect(tx).to.emit(profiles, 'BioSet').withArgs(alice.address, 'New bio.');
      await expect(tx).not.to.emit(profiles, 'NameSet');
      await expect(tx).not.to.emit(profiles, 'AvatarSet');
      await expect(tx).not.to.emit(profiles, 'XSet');
      const p = await profiles.profileOf(alice.address);
      expect([p.name, p.avatarId, p.bio, p.x]).to.deep.equal(['ace', 1n, 'New bio.', '_ace_won']);
    });

    it('is all or nothing: one bad value reverts every change', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await expect(profiles.connect(alice).setProfile('ace', 3, 'Hello.', 'ace')).to.be.revertedWithCustomError(profiles, 'NotCrystalOwner');
      await expect(profiles.connect(alice).setProfile('ace', 1, 'x'.repeat(121), 'ace')).to.be.revertedWithCustomError(profiles, 'InvalidBio');
      const p = await profiles.profileOf(alice.address);
      expect([p.name, p.avatarId, p.bio, p.x]).to.deep.equal(['', 0n, '', '']);
      expect(await profiles.addressOfName('ace')).to.equal(ethers.ZeroAddress);
    });

    it('multicall saves and clears in one transaction, as the caller', async () => {
      const { profiles, alice } = await loadFixture(deploy);
      await profiles.connect(alice).setProfile('ace', 1, 'Old bio.', 'ace');
      const i = profiles.interface;
      await expect(
        profiles
          .connect(alice)
          .multicall([i.encodeFunctionData('setProfile', ['ace_new', 0, '', '']), i.encodeFunctionData('clearBio'), i.encodeFunctionData('clearX')]),
      )
        .to.emit(profiles, 'NameSet')
        .withArgs(alice.address, 'ace_new')
        .and.to.emit(profiles, 'BioCleared')
        .withArgs(alice.address)
        .and.to.emit(profiles, 'XCleared')
        .withArgs(alice.address);
      const p = await profiles.profileOf(alice.address);
      expect([p.name, p.avatarId, p.bio, p.x]).to.deep.equal(['ace_new', 1n, '', '']);
    });
  });

  it('keeps everyone separate; only the caller changes their own profile', async () => {
    const { profiles, alice, bob } = await loadFixture(deploy);
    await profiles.connect(alice).setProfile('alice', 1, 'A', 'alice');
    await profiles.connect(bob).setProfile('bob', 3, 'B', 'bob');
    expect((await profiles.profileOf(alice.address)).name).to.equal('alice');
    expect((await profiles.profileOf(bob.address)).avatarId).to.equal(3n);
    await profiles.connect(bob).clearBio();
    expect((await profiles.profileOf(alice.address)).bio).to.equal('A');
  });

  it('has no admin surface', async () => {
    const { profiles } = await loadFixture(deploy);
    const fns = profiles.interface.fragments.filter((f) => f.type === 'function').map((f) => (f as { name: string }).name).sort();
    expect(fns).to.deep.equal([
      'CRYSTAL',
      'MAX_BIO_LENGTH',
      'MAX_NAME_LENGTH',
      'MAX_X_LENGTH',
      'MIN_NAME_LENGTH',
      'addressOfName',
      'avatarOf',
      'clearAvatar',
      'clearBio',
      'clearName',
      'clearX',
      'isValidBio',
      'isValidName',
      'isValidX',
      'multicall',
      'nameOf',
      'profileOf',
      'setAvatar',
      'setBio',
      'setName',
      'setProfile',
      'setX',
    ]);
  });

  it('packages/core/src/abi/prismProfiles.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(readFileSync(path.join(__dirname, '../artifacts/contracts/PrismProfiles.sol/PrismProfiles.json'), 'utf8'));
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismProfiles.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismProfilesAbi = ') + 'prismProfilesAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismProfilesBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});
