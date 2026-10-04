/**
 * Read-only Uniswap V4 liquidity probe on Robinhood Chain Testnet (46630).
 * Uses the PoolManager address published in the vibe/vibe chain config
 * (https://testnet.vibevibe.fun/api/v1/chains/46630/config) and reads pool
 * state with extsload — no transactions.
 *
 *   npx tsx packages/core/scripts/check-liquidity.ts
 */
import {
  createPublicClient,
  encodeAbiParameters,
  hexToBigInt,
  http,
  keccak256,
  pad,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { robinhoodChainTestnet } from '../src/chain';
import { TESTNET_TOKENS } from '../src/tokens';

const POOL_MANAGER: Address = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
const VIBE_FEE_HOOK: Address = '0x2779651feE12F6fB5A187578De6b63709f85d0Cc';
const NATIVE_ETH: Address = '0x0000000000000000000000000000000000000000';
const POOLS_SLOT = 6n; // StateLibrary.POOLS_SLOT in v4-core
const LIQUIDITY_OFFSET = 3n;

const client = createPublicClient({ chain: robinhoodChainTestnet, transport: http(undefined, { batch: true }) });
const extsloadAbi = [
  { type: 'function', name: 'extsload', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
] as const;

function poolId(a: Address, b: Address, fee: number, tickSpacing: number, hooks: Address): Hex {
  const [c0, c1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [c0, c1, fee, tickSpacing, hooks],
    ),
  );
}

async function poolState(id: Hex) {
  const stateSlot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, POOLS_SLOT]));
  const liqSlot = pad(toHex(hexToBigInt(stateSlot) + LIQUIDITY_OFFSET), { size: 32 });
  const [slot0, liq] = await Promise.all([
    client.readContract({ address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [stateSlot] }),
    client.readContract({ address: POOL_MANAGER, abi: extsloadAbi, functionName: 'extsload', args: [liqSlot] }),
  ]);
  const sqrtPriceX96 = hexToBigInt(slot0) & ((1n << 160n) - 1n);
  const liquidity = hexToBigInt(liq) & ((1n << 128n) - 1n);
  return { initialized: sqrtPriceX96 > 0n, sqrtPriceX96, liquidity };
}

const TIERS: Array<[number, number]> = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
];

async function main() {
  // sanity check: the canonical ETH/tSFUND pool from the vibe/vibe config must show up
  const canonical = await poolState('0xb933556d80062453de15c70946f933fa12e8f86da995dfe9933a77dc0ae81f32');
  console.log('sanity: vibe/vibe canonical ETH/tSFUND pool', canonical);

  const assets: Array<{ symbol: string; address: Address }> = [
    { symbol: 'ETH', address: NATIVE_ETH },
    ...TESTNET_TOKENS.map((t) => ({ symbol: t.symbol, address: t.address })),
  ];
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      for (const hooks of [NATIVE_ETH, VIBE_FEE_HOOK]) {
        for (const [fee, ts] of TIERS) {
          const id = poolId(assets[i]!.address, assets[j]!.address, fee, ts, hooks);
          const s = await poolState(id);
          if (s.initialized) {
            console.log(
              JSON.stringify({
                pair: `${assets[i]!.symbol}/${assets[j]!.symbol}`,
                fee,
                tickSpacing: ts,
                hooks,
                poolId: id,
                liquidity: s.liquidity.toString(),
              }),
            );
          }
        }
      }
    }
  }
  console.log('done (pairs not printed have no pool at the standard fee tiers)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
