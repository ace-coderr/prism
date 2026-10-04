import { useQuery } from '@tanstack/react-query';
import { erc20Abi, getAbiItem, type Address } from 'viem';
import {
  TESTNET_TOKENS,
  blockRanges,
  getDeployment,
  ownedFromTransfers,
  prismCrystalAbi,
  type TransferLog,
} from '@prism/core';
import { TARGET_CHAIN } from '../wallet/config';
import { testnetClient } from './chain';

/** getLogs range per request — 500k blocks stayed within the public RPC's limits in testing. */
const LOG_RANGE = 400_000n;
const transferEvent = getAbiItem({ abi: prismCrystalAbi, name: 'Transfer' });
const forgedEvent = getAbiItem({ abi: prismCrystalAbi, name: 'Forged' });

export interface CrystalAsset {
  token: Address | null; // null = native ETH
  symbol: string;
  decimals: number;
  amount: bigint;
}

export interface OnchainCrystal {
  id: bigint;
  assets: CrystalAsset[];
  sealedUntil: number; // unix seconds, 0 = never sealed
  /** Block of the forge transaction (its Forged event); null if it couldn't be read. */
  forgedBlock: bigint | null;
  /** What went in when it was forged (the Forged event), for forge-time weights. */
  forgedWith: CrystalAsset[];
}

interface ForgeRecord {
  block: bigint;
  assets: CrystalAsset[];
}

/**
 * Forged events (block + what went in), for the given ids or for every crystal,
 * read in RPC-safe block ranges from the deployment block.
 */
async function forgeRecords(crystal: Address, from: bigint, ids?: bigint[]): Promise<Map<bigint, ForgeRecord & { owner: Address }>> {
  const out = new Map<bigint, ForgeRecord & { owner: Address }>();
  if (ids && ids.length === 0) return out;
  const head = await testnetClient.getBlockNumber();
  for (const [a, b] of blockRanges(from, head, LOG_RANGE)) {
    const logs = await testnetClient.getLogs({
      address: crystal,
      event: forgedEvent,
      args: ids ? { id: ids } : undefined,
      fromBlock: a,
      toBlock: b,
    });
    for (const l of logs) {
      const tokens = l.args.tokens ?? [];
      const received = l.args.received ?? [];
      const assets: CrystalAsset[] = await Promise.all(
        tokens.map(async (token, i) => ({ token, amount: received[i] ?? 0n, ...(await tokenMeta(token)) })),
      );
      if ((l.args.eth ?? 0n) > 0n) assets.push({ token: null, symbol: 'ETH', decimals: 18, amount: l.args.eth! });
      out.set(l.args.id!, { block: l.blockNumber!, assets, owner: l.args.owner! });
    }
  }
  return out;
}

async function transferLogs(crystal: Address, owner: Address, from: bigint): Promise<TransferLog[]> {
  const head = await testnetClient.getBlockNumber();
  const out: TransferLog[] = [];
  for (const [a, b] of blockRanges(from, head, LOG_RANGE)) {
    // ids that ever moved to or from the owner; replaying both directions gives current ownership
    const [ins, outs] = await Promise.all([
      testnetClient.getLogs({ address: crystal, event: transferEvent, args: { to: owner }, fromBlock: a, toBlock: b }),
      testnetClient.getLogs({ address: crystal, event: transferEvent, args: { from: owner }, fromBlock: a, toBlock: b }),
    ]);
    for (const l of [...ins, ...outs]) {
      out.push({
        from: l.args.from!,
        to: l.args.to!,
        tokenId: l.args.tokenId!,
        blockNumber: l.blockNumber!,
        logIndex: l.logIndex!,
      });
    }
  }
  return out;
}

const known = new Map(TESTNET_TOKENS.map((t) => [t.address.toLowerCase(), t]));

async function tokenMeta(token: Address) {
  const k = known.get(token.toLowerCase());
  if (k) return { symbol: k.id, decimals: k.decimals };
  const [symbol, decimals] = await Promise.all([
    testnetClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => `${token.slice(0, 6)}…`),
    testnetClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { symbol, decimals };
}

/** One crystal's contents and seal, read from the contract. */
async function readCrystal(crystal: Address, id: bigint, forged?: ForgeRecord): Promise<OnchainCrystal> {
  const [[tokens, balances, eth], sealed] = await Promise.all([
    testnetClient.readContract({ address: crystal, abi: prismCrystalAbi, functionName: 'holdings', args: [id] }),
    testnetClient.readContract({ address: crystal, abi: prismCrystalAbi, functionName: 'sealedUntil', args: [id] }),
  ]);
  const assets: CrystalAsset[] = await Promise.all(
    tokens.map(async (token, i) => ({ token, amount: balances[i]!, ...(await tokenMeta(token)) })),
  );
  if (eth > 0n) assets.push({ token: null, symbol: 'ETH', decimals: 18, amount: eth });
  return { id, assets, sealedUntil: Number(sealed), forgedBlock: forged?.block ?? null, forgedWith: forged?.assets ?? [] };
}

/** The connected wallet's real crystals (read-only). */
export function useMyCrystals(owner: Address | undefined) {
  const deployment = getDeployment(TARGET_CHAIN.id);
  return useQuery({
    queryKey: ['my-crystals', deployment?.prismCrystal, owner],
    enabled: !!owner && !!deployment,
    refetchInterval: 30_000,
    queryFn: async (): Promise<OnchainCrystal[]> => {
      const crystal = deployment!.prismCrystal;
      const logs = await transferLogs(crystal, owner!, deployment!.fromBlock);
      const ids = ownedFromTransfers(logs, owner!);
      const forged = await forgeRecords(crystal, deployment!.fromBlock, ids).catch(() => new Map<bigint, ForgeRecord>());
      return Promise.all(ids.map((id) => readCrystal(crystal, id, forged.get(id))));
    },
  });
}

export interface PublicCrystal extends OnchainCrystal {
  owner: Address;
}

/**
 * Every real crystal ever forged that still exists: Forged events (read in RPC-safe
 * block ranges), then current owner + contents. Burned crystals are skipped.
 */
export function useAllCrystals() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  return useQuery({
    queryKey: ['all-crystals', deployment?.prismCrystal],
    enabled: !!deployment,
    refetchInterval: 60_000,
    queryFn: async (): Promise<PublicCrystal[]> => {
      const crystal = deployment!.prismCrystal;
      const forged = await forgeRecords(crystal, deployment!.fromBlock);
      const rows = await Promise.all(
        [...forged.entries()].map(async ([id, rec]) => {
          const owner = await testnetClient
            .readContract({ address: crystal, abi: prismCrystalAbi, functionName: 'ownerOf', args: [id] })
            .catch(() => null); // burned
          if (!owner) return null;
          return { ...(await readCrystal(crystal, id, rec)), owner };
        }),
      );
      return rows.filter((r): r is PublicCrystal => r !== null).sort((a, b) => (a.id < b.id ? -1 : 1));
    },
  });
}

/** Earliest forge block among crystals (how far back their price history must reach). */
export const earliestForge = (crystals: OnchainCrystal[] | undefined) =>
  (crystals ?? []).reduce<bigint | null>((m, c) => (c.forgedBlock !== null && (m === null || c.forgedBlock < m) ? c.forgedBlock : m), null);
