/**
 * Read-only: checks that the deployed PrismReviews (v2) is exactly this repo's compiled contract.
 * Its creation transaction must be the compiled creation bytecode followed by its one constructor
 * argument (firstId), the code at its address the compiled runtime bytecode (with firstId filled in
 * where the compiler left room for the immutable), and firstId must continue right after the retired
 * first contract's last review.
 *
 *   npm run compile -w @prism/contracts && npx tsx packages/core/scripts/check-deployment.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createPublicClient, encodeAbiParameters, http, type Hex, type PublicClient } from 'viem';
import { getDeployment, prismReviewsAbi, robinhoodChainTestnet } from '../src';

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http() }) as PublicClient;
const d = getDeployment(robinhoodChainTestnet.id);
if (!d?.prismReviews || !d.prismReviewsTx) throw new Error('PrismReviews is not in deployments.ts');

const art = JSON.parse(readFileSync(new URL('../../../contracts/artifacts/contracts/PrismReviews.sol/PrismReviews.json', import.meta.url), 'utf8'));
const [tx, receipt, code, firstId] = await Promise.all([
  client.getTransaction({ hash: d.prismReviewsTx }),
  client.getTransactionReceipt({ hash: d.prismReviewsTx }),
  client.getCode({ address: d.prismReviews }),
  client.readContract({ address: d.prismReviews, abi: prismReviewsAbi, functionName: 'firstId' }),
]);
const arg = encodeAbiParameters([{ type: 'uint64' }], [firstId]).slice(2);

/** The compiled runtime bytecode with `firstId` written where the compiler left room for the immutable. */
function runtimeWithImmutables(): Hex {
  const dir = new URL('../../../contracts/artifacts/build-info/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const info = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const c = info.output?.contracts?.['contracts/PrismReviews.sol']?.PrismReviews;
    if (!c || `0x${c.evm.deployedBytecode.object}`.toLowerCase() !== art.deployedBytecode.toLowerCase()) continue;
    let hex = (art.deployedBytecode as string).slice(2);
    const word = BigInt(firstId).toString(16).padStart(64, '0');
    for (const refs of Object.values(c.evm.deployedBytecode.immutableReferences as Record<string, Array<{ start: number; length: number }>>)) {
      for (const { start, length } of refs) hex = hex.slice(0, start * 2) + word.slice(64 - length * 2) + hex.slice((start + length) * 2);
    }
    return `0x${hex}`;
  }
  throw new Error('No build-info for the compiled PrismReviews: run npm run compile -w @prism/contracts');
}

const retired = d.retiredReviews;
const checks: Record<string, boolean> = {
  'creation succeeded': receipt.status === 'success',
  'created this address': receipt.contractAddress?.toLowerCase() === d.prismReviews.toLowerCase(),
  'in the recorded block': receipt.blockNumber === d.prismReviewsFromBlock,
  'creation input = compiled bytecode + firstId': tx.input.toLowerCase() === `${art.bytecode}${arg}`.toLowerCase(),
  'runtime code = compiled runtime (firstId filled in)': code?.toLowerCase() === runtimeWithImmutables().toLowerCase(),
  [`firstId (${firstId}) continues after the retired contract`]: retired ? BigInt(firstId) === BigInt(retired.lastId + 1) : true,
};
for (const [what, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
if (Object.values(checks).some((ok) => !ok)) process.exit(1);
