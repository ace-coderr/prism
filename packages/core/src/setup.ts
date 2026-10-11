/**
 * How a launch is set up, read from its own contracts (never vibe/vibe's API), in plain words.
 *
 * - v6: the creator picks a project tax (1–3% of every trade) and splits their part of it between
 *   their treasury (paid in the pair asset), holder rewards in the pair asset, holder rewards in the
 *   token and a burn. The protocol keeps a fixed 20% of the tax. A gift list, if any, is airdropped
 *   at graduation. (The split is the token's `packedWeights`: four 16-bit weights out of 10,000 for
 *   treasury, holders-in-token, burn, holders-in-pair, as vibe/vibe's own app decodes them.)
 * - gen 0/1/2: no creator-chosen tax. The curve charges a fixed fee (1.25%), split between the
 *   creator's vault and the protocol (75/25 on the curves read so far); no burns, rewards or airdrops.
 */
import { erc20Abi, parseAbi, type Address, type PublicClient } from 'viem';
import type { Launch } from './launches';

export interface TaxSplit {
  /** weights out of 10,000 of the creator's part of the tax */
  treasury: number;
  holdersPair: number;
  holdersToken: number;
  burn: number;
}

/** vibe/vibe v6: 20% of the tax goes to the protocol, 80% follows the creator's split. */
export const V6_PROTOCOL_SHARE_BPS = 2000;
/** v6: tokens sold on the curve before it graduates (800M of 1B). */
export const V6_CURVE_TOKENS = 800_000_000n * 10n ** 18n;

export const decodePackedWeights = (packed: bigint): TaxSplit => ({
  treasury: Number(packed & 0xffffn),
  holdersToken: Number((packed >> 16n) & 0xffffn),
  burn: Number((packed >> 32n) & 0xffffn),
  holdersPair: Number((packed >> 48n) & 0xffffn),
});

export type LaunchSetup =
  | {
      kind: 'v6';
      taxBps: number;
      split: TaxSplit | null;
      protocolShareBps: number;
      /** null: none configured */
      airdrop: { wallets: number; tokens: bigint } | null;
      projectTreasury: Address | null;
      createdAt: number | null;
      /** 0..1 of the curve sold; 1 once graduated */
      progress: number | null;
      graduated: boolean | null;
    }
  | {
      kind: 'curve-fee';
      feeBps: number | null;
      creatorShareBps: number | null;
      creatorVault: Address | null;
      createdAt: number | null;
      progress: number | null;
      graduated: boolean | null;
    }
  | { kind: 'stock' };

export interface SetupLine {
  label: string;
  value: string;
  /** false: "not available for this launch generation" (shown muted) */
  available: boolean;
}

const pct = (bps: number) => {
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}%`;
};
const NOT_AVAILABLE = 'Not available for this launch generation';

/** One plain line per fact. `token`/`pair`: symbols as people know them ("$MOON", "ETH"). */
export function setupLines(setup: LaunchSetup, token: string, pair: string): SetupLine[] {
  if (setup.kind === 'stock') {
    return [{ label: 'Launch setup', value: 'A vibe/vibe test stock: no launch, tax or bonding curve.', available: false }];
  }
  if (setup.kind === 'curve-fee') {
    const fee = setup.feeBps;
    const creator = setup.creatorShareBps;
    return [
      { label: 'Project tax', value: `${NOT_AVAILABLE}: its curve charges a fixed ${fee === null ? '' : `${pct(fee)} `}fee instead.`, available: false },
      {
        label: 'Creator’s part',
        value: creator === null || fee === null ? 'Couldn’t be read.' : `${pct(creator)} of the fee (${pct((fee * creator) / 10000)} of every trade) to the creator’s vault.`,
        available: creator !== null,
      },
      { label: 'Holder rewards & burn', value: NOT_AVAILABLE, available: false },
      {
        label: 'Protocol share',
        value: creator === null || fee === null ? 'Couldn’t be read.' : `Fixed ${pct(10000 - creator)} of the fee (${pct((fee * (10000 - creator)) / 10000)} of every trade).`,
        available: creator !== null,
      },
      { label: 'Graduation airdrop', value: NOT_AVAILABLE, available: false },
    ];
  }
  const tax = setup.taxBps;
  const creatorPart = 10000 - setup.protocolShareBps;
  const ofTrade = (weight: number) => pct((tax * creatorPart * weight) / 1e8);
  const leg = (weight: number, what: string) => (weight > 0 ? `${pct(weight)} of the creator’s part → ${what} (${ofTrade(weight)} of every trade)` : 'None');
  const s = setup.split;
  return [
    { label: 'Project tax', value: `${pct(tax)} of every trade.`, available: true },
    { label: 'Treasury', value: s ? leg(s.treasury, `the project treasury, paid in ${pair}`) : 'Couldn’t be read.', available: !!s },
    { label: `Holder rewards in ${pair}`, value: s ? leg(s.holdersPair, `holders, paid in ${pair}`) : 'Couldn’t be read.', available: !!s },
    { label: `Holder rewards in ${token}`, value: s ? leg(s.holdersToken, `holders, paid in ${token}`) : 'Couldn’t be read.', available: !!s },
    { label: 'Burn', value: s ? leg(s.burn, `burned ${token}`) : 'Couldn’t be read.', available: !!s },
    { label: 'Protocol share', value: `Fixed ${pct(setup.protocolShareBps)} of the tax (${pct((tax * setup.protocolShareBps) / 10000)} of every trade).`, available: true },
    {
      label: 'Graduation airdrop',
      value: setup.airdrop ? `${setup.airdrop.wallets.toLocaleString('en-US')} wallet${setup.airdrop.wallets === 1 ? '' : 's'} get ${token} when it graduates.` : 'None configured.',
      available: true,
    },
  ];
}

// ------------------------------------------------------------------ reading it

const v6CurveAbi = parseAbi([
  'function baseTaxBps() view returns (uint256)',
  'function sold() view returns (uint120)',
  'function complete() view returns (bool)',
  'function createdAt() view returns (uint256)',
  'function projectTreasury() view returns (address)',
]);
const v6TokenAbi = parseAbi([
  'function packedWeights() view returns (uint64)',
  'function giftCount() view returns (uint256)',
  'function giftReserved() view returns (uint256)',
]);
const feeCurveAbi = parseAbi([
  'function TOTAL_FEE_BPS() view returns (uint256)',
  'function CREATOR_FEE_SHARE_BPS() view returns (uint256)',
  'function CURVE_INVENTORY() view returns (uint256)',
  'function curveTokensRemaining() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function launchTimestamp() view returns (uint256)',
  'function creatorVault() view returns (address)',
]);

type R = { status: 'success'; result: unknown } | { status: 'failure'; error: unknown };
const ok = <T>(r: R | undefined): T | null => (r?.status === 'success' ? (r.result as T) : null);
const ratio = (part: bigint, whole: bigint) => (whole > 0n ? Math.min(1, Number((part * 10000n) / whole) / 10000) : null);

/** A launch's setup, read live from its curve and token (one multicall). */
export async function readLaunchSetup(client: PublicClient, launch: Pick<Launch, 'gen' | 'curve' | 'token'>): Promise<LaunchSetup> {
  if (launch.gen === 6) {
    const r = (await client.multicall({
      allowFailure: true,
      contracts: [
        { address: launch.curve, abi: v6CurveAbi, functionName: 'baseTaxBps' },
        { address: launch.curve, abi: v6CurveAbi, functionName: 'sold' },
        { address: launch.curve, abi: v6CurveAbi, functionName: 'complete' },
        { address: launch.curve, abi: v6CurveAbi, functionName: 'createdAt' },
        { address: launch.curve, abi: v6CurveAbi, functionName: 'projectTreasury' },
        { address: launch.token, abi: v6TokenAbi, functionName: 'packedWeights' },
        { address: launch.token, abi: v6TokenAbi, functionName: 'giftCount' },
        { address: launch.token, abi: v6TokenAbi, functionName: 'giftReserved' },
      ],
    })) as R[];
    const sold = ok<bigint>(r[1]);
    const graduated = ok<boolean>(r[2]);
    const packed = ok<bigint>(r[5]);
    const gifts = ok<bigint>(r[6]);
    return {
      kind: 'v6',
      taxBps: Number(ok<bigint>(r[0]) ?? 0n),
      split: packed === null ? null : decodePackedWeights(packed),
      protocolShareBps: V6_PROTOCOL_SHARE_BPS,
      airdrop: gifts !== null && gifts > 0n ? { wallets: Number(gifts), tokens: ok<bigint>(r[7]) ?? 0n } : null,
      projectTreasury: ok<Address>(r[4]),
      createdAt: ok<bigint>(r[3]) === null ? null : Number(ok<bigint>(r[3])),
      progress: graduated ? 1 : sold === null ? null : ratio(sold, V6_CURVE_TOKENS),
      graduated,
    };
  }
  const r = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: launch.curve, abi: feeCurveAbi, functionName: 'TOTAL_FEE_BPS' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'CREATOR_FEE_SHARE_BPS' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'CURVE_INVENTORY' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'curveTokensRemaining' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'graduated' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'launchTimestamp' },
      { address: launch.curve, abi: feeCurveAbi, functionName: 'creatorVault' },
    ],
  })) as R[];
  const inventory = ok<bigint>(r[2]);
  const remaining = ok<bigint>(r[3]);
  const graduated = ok<boolean>(r[4]);
  const created = ok<bigint>(r[5]);
  return {
    kind: 'curve-fee',
    feeBps: ok<bigint>(r[0]) === null ? null : Number(ok<bigint>(r[0])),
    creatorShareBps: ok<bigint>(r[1]) === null ? null : Number(ok<bigint>(r[1])),
    creatorVault: ok<Address>(r[6]),
    createdAt: created === null ? null : Number(created),
    progress: graduated ? 1 : inventory === null || remaining === null ? null : ratio(inventory - remaining, inventory),
    graduated,
  };
}

/** totalSupply and decimals of many tokens in one multicall (null where a read failed). */
export async function readSupplies(client: PublicClient, tokens: readonly Address[]): Promise<Map<string, { supply: bigint; decimals: number } | null>> {
  if (tokens.length === 0) return new Map();
  const r = (await client.multicall({
    allowFailure: true,
    contracts: tokens.flatMap((address) => [
      { address, abi: erc20Abi, functionName: 'totalSupply' } as const,
      { address, abi: erc20Abi, functionName: 'decimals' } as const,
    ]),
  })) as R[];
  return new Map(
    tokens.map((t, i) => {
      const supply = ok<bigint>(r[i * 2]);
      const decimals = ok<number>(r[i * 2 + 1]);
      return [t.toLowerCase(), supply === null ? null : { supply, decimals: decimals ?? 18 }];
    }),
  );
}
