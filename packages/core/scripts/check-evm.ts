/**
 * Does Robinhood Chain Testnet execute the Cancun opcodes solc may emit (PUSH0, MCOPY,
 * TSTORE/TLOAD)? And does PrismCrystal's real creation code run there? Uses eth_call with
 * no `to` (runs init code) — no key, no transaction.
 *
 *   npx hardhat compile (in /contracts), then: npx tsx packages/core/scripts/check-evm.ts
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, type Hex } from 'viem';
import { robinhoodChainTestnet } from '../src/chain';

const c = createPublicClient({ chain: robinhoodChainTestnet, transport: http() });

// PUSH1 2a PUSH1 01 TSTORE | PUSH1 01 TLOAD | PUSH0 MSTORE | PUSH1 20 PUSH0 PUSH1 20 MCOPY | PUSH1 20 PUSH1 20 RETURN
const probe = '0x602a60015d60015c5f5260205f60205e60206020f3' as Hex;
try {
  const r = await c.call({ data: probe });
  console.log('PUSH0+TSTORE/TLOAD+MCOPY probe →', r.data, r.data?.endsWith('2a') ? 'OK' : 'UNEXPECTED');
} catch (e) {
  console.log('probe FAILED:', (e as Error).message.split('\n')[0]);
}
// BLOBBASEFEE (0x4a): PUSH... BLOBBASEFEE PUSH0 MSTORE PUSH1 20 PUSH0 RETURN
try {
  const r = await c.call({ data: '0x4a5f5260205ff3' });
  console.log('BLOBBASEFEE →', r.data);
} catch (e) {
  console.log('BLOBBASEFEE FAILED:', (e as Error).message.split('\n')[0]);
}

const art = JSON.parse(readFileSync(new URL('../../../contracts/artifacts/contracts/PrismCrystal.sol/PrismCrystal.json', import.meta.url), 'utf8'));
const runtime: string = art.deployedBytecode;
try {
  const r = await c.call({ data: art.bytecode as Hex, gas: 30_000_000n });
  console.log('PrismCrystal creation via eth_call → runtime matches artifact:', r.data?.toLowerCase() === runtime.toLowerCase());
  const gas = await c.estimateGas({ data: art.bytecode as Hex, account: '0x000000000000000000000000000000000000dEaD' });
  console.log('estimateGas for deployment:', gas);
} catch (e) {
  console.log('creation FAILED:', (e as Error).message.split('\n')[0]);
}
