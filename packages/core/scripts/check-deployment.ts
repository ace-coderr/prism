/**
 * Read-only: checks that the deployed PrismReviews is exactly this repo's compiled contract.
 * Its creation transaction must be the compiled creation bytecode (no constructor arguments) and
 * the code at its address the compiled runtime bytecode, byte for byte.
 *
 *   npm run compile -w @prism/contracts && npx tsx packages/core/scripts/check-deployment.ts
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, type PublicClient } from 'viem';
import { getDeployment, robinhoodChainTestnet } from '../src';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http() }) as PublicClient;
const d = getDeployment(robinhoodChainTestnet.id);
if (!d?.prismReviews || !d.prismReviewsTx) throw new Error('PrismReviews is not in deployments.ts');

const art = JSON.parse(readFileSync(new URL('../../../contracts/artifacts/contracts/PrismReviews.sol/PrismReviews.json', import.meta.url), 'utf8'));
const [tx, receipt, code] = await Promise.all([
  client.getTransaction({ hash: d.prismReviewsTx }),
  client.getTransactionReceipt({ hash: d.prismReviewsTx }),
  client.getCode({ address: d.prismReviews }),
]);
const checks = {
  'creation succeeded': receipt.status === 'success',
  'created this address': receipt.contractAddress?.toLowerCase() === d.prismReviews.toLowerCase(),
  'in the recorded block': receipt.blockNumber === d.prismReviewsFromBlock,
  'creation input = compiled bytecode': tx.input.toLowerCase() === art.bytecode.toLowerCase(),
  'runtime code = compiled runtime': code?.toLowerCase() === art.deployedBytecode.toLowerCase(),
};
for (const [what, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
