import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

async function deploy() {
  const [alice, bob, carol] = await ethers.getSigners();
  const names = await ethers.deployContract('PrismNames');
  return { names, alice, bob, carol };
}

describe('PrismNames', () => {
  describe('rules', () => {
    it('accepts 3–20 characters of a–z, 0–9 and underscore', async () => {
      const { names } = await loadFixture(deploy);
      for (const ok of ['ace', 'abc_123', 'a_b', '000', 'x'.repeat(20), 'under_score_']) {
        expect(await names.isValid(ok), ok).to.equal(true);
      }
    });

    it('refuses too short, too long, uppercase, spaces, symbols and non-ASCII', async () => {
      const { names } = await loadFixture(deploy);
      for (const bad of ['', 'ab', 'x'.repeat(21), 'Ace', 'ACE', 'a b', 'a-b', 'a.b', 'é_ab', 'ace!', 'ａｂｃ', 'ab\u0000']) {
        expect(await names.isValid(bad), JSON.stringify(bad)).to.equal(false);
        await expect(names.setName(bad)).to.be.revertedWithCustomError(names, 'InvalidName');
      }
    });
  });

  describe('claiming', () => {
    it('sets a name, with lookups both ways and an event', async () => {
      const { names, alice } = await loadFixture(deploy);
      await expect(names.connect(alice).setName('ace')).to.emit(names, 'NameSet').withArgs(alice.address, 'ace');
      expect(await names.nameOf(alice.address)).to.equal('ace');
      expect(await names.ownerOfName('ace')).to.equal(alice.address);
      expect(await names.ownerOfName('nobody')).to.equal(ethers.ZeroAddress);
      expect(await names.nameOf(ethers.ZeroAddress)).to.equal('');
    });

    it('is first come, first served: a taken name is refused', async () => {
      const { names, alice, bob } = await loadFixture(deploy);
      await names.connect(alice).setName('ace');
      await expect(names.connect(bob).setName('ace')).to.be.revertedWithCustomError(names, 'NameTaken').withArgs(alice.address);
      await expect(names.connect(alice).setName('ace')).to.be.revertedWithCustomError(names, 'AlreadyYours');
    });

    it('changing your name releases the old one', async () => {
      const { names, alice, bob } = await loadFixture(deploy);
      await names.connect(alice).setName('ace');
      await expect(names.connect(alice).setName('ace_two'))
        .to.emit(names, 'NameCleared')
        .withArgs(alice.address, 'ace')
        .and.to.emit(names, 'NameSet')
        .withArgs(alice.address, 'ace_two');
      expect(await names.ownerOfName('ace')).to.equal(ethers.ZeroAddress);
      expect(await names.nameOf(alice.address)).to.equal('ace_two');
      // the old name is free for anyone now
      await names.connect(bob).setName('ace');
      expect(await names.ownerOfName('ace')).to.equal(bob.address);
    });

    it('clearName frees the name; clearing with no name reverts', async () => {
      const { names, alice, bob } = await loadFixture(deploy);
      await expect(names.connect(alice).clearName()).to.be.revertedWithCustomError(names, 'NoName');
      await names.connect(alice).setName('ace');
      await expect(names.connect(alice).clearName()).to.emit(names, 'NameCleared').withArgs(alice.address, 'ace');
      expect(await names.nameOf(alice.address)).to.equal('');
      expect(await names.ownerOfName('ace')).to.equal(ethers.ZeroAddress);
      await names.connect(bob).setName('ace');
      expect(await names.nameOf(bob.address)).to.equal('ace');
    });

    it('keeps everyone separate', async () => {
      const { names, alice, bob, carol } = await loadFixture(deploy);
      await names.connect(alice).setName('alice');
      await names.connect(bob).setName('bob');
      await names.connect(carol).setName('carol_3');
      expect(await names.nameOf(alice.address)).to.equal('alice');
      expect(await names.nameOf(bob.address)).to.equal('bob');
      expect(await names.ownerOfName('carol_3')).to.equal(carol.address);
    });
  });

  it('has no admin surface', async () => {
    const { names } = await loadFixture(deploy);
    const fns = names.interface.fragments.filter((f) => f.type === 'function').map((f) => (f as { name: string }).name).sort();
    expect(fns).to.deep.equal(['MAX_LENGTH', 'MIN_LENGTH', 'clearName', 'isValid', 'nameOf', 'ownerOfName', 'setName']);
  });

  it('packages/core/src/abi/prismNames.ts matches the compiled artifact (run export-abi after changes)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const art = JSON.parse(readFileSync(path.join(__dirname, '../artifacts/contracts/PrismNames.sol/PrismNames.json'), 'utf8'));
    const src = readFileSync(path.join(__dirname, '../../packages/core/src/abi/prismNames.ts'), 'utf8');
    const abiJson = src.slice(src.indexOf('prismNamesAbi = ') + 'prismNamesAbi = '.length, src.indexOf(' as const;'));
    const bytecode = /prismNamesBytecode = '(0x[0-9a-f]+)'/.exec(src)?.[1];
    expect(bytecode).to.equal(art.bytecode);
    expect(JSON.parse(abiJson)).to.deep.equal(art.abi);
  });
});
