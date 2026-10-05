/**
 * Confirms the deployed PRISM contracts match this repo's compiled contracts exactly,
 * read-only: PrismCrystal, and (once recorded in deployments.ts) PrismForgeRouter and
 * PrismProfiles with their constructor arguments.
 *
 *   npx tsx packages/core/scripts/check-deployment.ts
 */
import { createPublicClient, encodeAbiParameters, http, type Abi, type AbiParameter, type Address, type Hex } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';
import { getDeployment } from '../src/deployments';
import { prismCrystalAbi, prismCrystalBytecode } from '../src/abi/prismCrystal';
import { prismForgeRouterAbi, prismForgeRouterBytecode } from '../src/abi/prismForgeRouter';
import { prismProfilesAbi, prismProfilesBytecode } from '../src/abi/prismProfiles';
import { routerDeployArgs } from '../src/forgeFromEth';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http() });

/** Creation code + ABI-encoded constructor args, exactly as a deploy sends it. */
function initCode(abi: Abi, bytecode: Hex, args: readonly unknown[]): Hex {
  const ctor = abi.find((x) => x.type === 'constructor') as { inputs: readonly AbiParameter[] } | undefined;
  if (!ctor || args.length === 0) return bytecode;
  return `${bytecode}${encodeAbiParameters(ctor.inputs, args).slice(2)}` as Hex;
}

async function check(label: string, address: Address, txHash: Hex | undefined, abi: Abi, bytecode: Hex, args: readonly unknown[], block?: bigint) {
  const init = initCode(abi, bytecode, args);
  const onchain = (await client.getCode({ address })) ?? '0x';
  // expected runtime = what the creation code returns (immutables filled from the args)
  const { data: expected } = await client.call({ data: init, gas: 30_000_000n });
  console.log(`\n${label}`);
  console.log('  address        ', address);
  console.log('  runtime bytes  ', (onchain.length - 2) / 2);
  console.log('  runtime matches compiled + args exactly:', onchain.toLowerCase() === expected?.toLowerCase());
  if (!txHash) return;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  console.log('  deploy tx      ', txHash, receipt.status);
  console.log('  deployer       ', tx.from);
  console.log('  block          ', receipt.blockNumber, block === undefined ? '' : receipt.blockNumber === block ? '(matches deployments.ts)' : '(MISMATCH)');
  console.log('  created address', receipt.contractAddress, receipt.contractAddress?.toLowerCase() === address.toLowerCase() ? '(matches)' : '(MISMATCH)');
  console.log('  creation input = compiled bytecode + expected args:', tx.input.toLowerCase() === init.toLowerCase());
}

async function main() {
  const d = getDeployment(robinhoodChainTestnet.id);
  if (!d) throw new Error('no deployment recorded in deployments.ts');

  await check('PrismCrystal', d.prismCrystal, d.txHash, prismCrystalAbi as Abi, prismCrystalBytecode, [], d.fromBlock);
  const [name, symbol] = await Promise.all([
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'name' }),
    client.readContract({ address: d.prismCrystal, abi: prismCrystalAbi, functionName: 'symbol' }),
  ]);
  console.log('  name/symbol    ', name, symbol);

  if (d.forgeRouter) {
    await check('PrismForgeRouter', d.forgeRouter, d.forgeRouterTx, prismForgeRouterAbi as Abi, prismForgeRouterBytecode, routerDeployArgs(d.prismCrystal));
  }
  if (d.prismProfiles) {
    await check('PrismProfiles', d.prismProfiles, d.prismProfilesTx, prismProfilesAbi as Abi, prismProfilesBytecode, [d.prismCrystal]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
