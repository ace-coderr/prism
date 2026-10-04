/**
 * Confirms the deployed PrismCrystal matches the compiled contract exactly, read-only.
 *
 *   npx tsx packages/core/scripts/check-deployment.ts
 */
import { createPublicClient, http, type Hex } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';
import { getDeployment } from '../src/deployments';
import { prismCrystalAbi, prismCrystalBytecode } from '../src/abi/prismCrystal';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http() });

async function main() {
  const d = getDeployment(robinhoodChainTestnet.id);
  if (!d) throw new Error('no deployment recorded in deployments.ts');

  const onchain = (await client.getCode({ address: d.prismCrystal })) ?? '0x';
  // expected runtime = what the creation code returns (no constructor args / immutables)
  const { data: expected } = await client.call({ data: prismCrystalBytecode as Hex, gas: 30_000_000n });
  console.log('address        ', d.prismCrystal);
  console.log('runtime bytes  ', (onchain.length - 2) / 2);
  console.log('runtime matches compiled PrismCrystal exactly:', onchain.toLowerCase() === expected?.toLowerCase());

  if (d.txHash) {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: d.txHash }),
      client.getTransactionReceipt({ hash: d.txHash }),
    ]);
    console.log('deploy tx      ', d.txHash, receipt.status);
    console.log('deployer       ', tx.from);
    console.log('block          ', receipt.blockNumber, receipt.blockNumber === d.fromBlock ? '(matches deployments.ts)' : '(MISMATCH)');
    console.log('created address', receipt.contractAddress);
    console.log('creation input matches compiled bytecode:', tx.input.toLowerCase() === prismCrystalBytecode.toLowerCase());
  }

  const [name, symbol] = await Promise.all([
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'name' }),
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'symbol' }),
  ]);
  console.log('name/symbol    ', name, symbol);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
