import { expect } from 'chai';
import { ethers } from 'hardhat';

// Prints gas for typical calls (first-time deposits into fresh storage, i.e. worst-ish case).
describe('PrismCrystal gas', () => {
  it('reports gas for forge / withdraw / withdrawAllAndBurn', async () => {
    const [alice] = await ethers.getSigners();
    const crystal = await ethers.deployContract('PrismCrystal');
    const addr = await crystal.getAddress();
    const deployGas = (await crystal.deploymentTransaction()!.wait())!.gasUsed;

    const tokens = [];
    for (let i = 0; i < 8; i++) {
      const t = await ethers.deployContract('MockERC20', [`T${i}`, `T${i}`, 18]);
      await t.mint(alice.address, ethers.parseEther('1000'));
      await t.approve(addr, ethers.MaxUint256);
      tokens.push(await t.getAddress());
    }
    const one = ethers.parseEther('1');
    const gas = async (p: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) => (await (await p).wait())!.gasUsed;

    const rows: Record<string, bigint> = {
      'deploy PrismCrystal': deployGas,
      'forge: ETH only': await gas(crystal.forge([], [], { value: one })),
      'forge: 1 token': await gas(crystal.forge([tokens[0]!], [one])),
      'forge: 3 tokens + ETH': await gas(crystal.forge(tokens.slice(0, 3), [one, one, one], { value: one })),
      'forge: 8 tokens': await gas(crystal.forge(tokens, tokens.map(() => one))),
    };
    // crystal #3 holds 3 tokens + ETH
    rows['withdraw: 1 token (partial)'] = await gas(crystal.withdraw(3, [tokens[0]!], [one / 2n], 0, alice.address));
    rows['withdraw: 2 tokens + ETH'] = await gas(
      crystal.withdraw(3, [tokens[1]!, tokens[2]!], [one / 2n, one / 2n], one / 2n, alice.address),
    );
    rows['withdrawAllAndBurn: 3 tokens + ETH'] = await gas(crystal.withdrawAllAndBurn(3, alice.address));
    rows['withdrawAllAndBurn: 8 tokens'] = await gas(crystal.withdrawAllAndBurn(4, alice.address));
    rows['seal'] = await gas(crystal.seal(2, BigInt((await ethers.provider.getBlock('latest'))!.timestamp + 3600)));

    console.table(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { gas: Number(v) }])));
    expect(rows['forge: 8 tokens']).to.be.lessThan(1_500_000n);
  });
});
