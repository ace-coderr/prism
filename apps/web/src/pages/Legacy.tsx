import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { erc20Abi, formatEther, parseAbi, type Address, type Hex } from 'viem';
import { simulateContract } from 'wagmi/actions';
import { TESTNET_TOKENS, explorerAddressUrl, getDeployment, getLogsSplit } from '@prism/core';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { GuideNote } from '../components/Viber';
import { testnetClient } from '../data/chain';
import { dateText, formatTokens } from '../data/format';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton, useWallet } from '../wallet/WalletButton';

/** The archived PRISM v1 crystal contract: only what this page needs. */
const crystalAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function ownerOf(uint256 id) view returns (address)',
  'function holdings(uint256 id) view returns (address[] tokens, uint256[] balances, uint256 eth)',
  'function sealedUntil(uint256 id) view returns (uint64)',
  'function withdrawAllAndBurn(uint256 id, address to)',
]);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const legacy = () => getDeployment(TARGET_CHAIN.id)?.legacy;

interface Crystal {
  id: bigint;
  eth: bigint;
  assets: Array<{ token: Address; symbol: string; amount: bigint; decimals: number }>;
  sealedUntil: number;
}

/** The wallet's v1 crystals: Transfer logs say which ids it received; ownerOf confirms it still has them. */
async function readCrystals(owner: Address): Promise<Crystal[]> {
  const d = legacy();
  if (!d) return [];
  const topic = `0x${owner.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
  const head = await testnetClient.getBlockNumber();
  const logs = (await getLogsSplit(testnetClient, { address: d.prismCrystal, topics: [TRANSFER, null, topic] }, d.prismCrystalFromBlock, head)) as unknown as Array<{ topics: Hex[] }>;
  const ids = [...new Set(logs.map((l) => BigInt(l.topics[3]!)))];
  const out: Crystal[] = [];
  for (const id of ids) {
    const holder = await testnetClient.readContract({ address: d.prismCrystal, abi: crystalAbi, functionName: 'ownerOf', args: [id] }).catch(() => null);
    if (!holder || holder.toLowerCase() !== owner.toLowerCase()) continue; // burned or given away since
    const [tokens, balances, eth] = await testnetClient.readContract({ address: d.prismCrystal, abi: crystalAbi, functionName: 'holdings', args: [id] });
    const sealed = await testnetClient.readContract({ address: d.prismCrystal, abi: crystalAbi, functionName: 'sealedUntil', args: [id] });
    const assets = await Promise.all(
      tokens.map(async (token, i) => {
        const known = TESTNET_TOKENS.find((t) => t.address.toLowerCase() === token.toLowerCase());
        const symbol = known?.id ?? (await testnetClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }).catch(() => `${token.slice(0, 6)}…`));
        const decimals = known?.decimals ?? Number(await testnetClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18));
        return { token, symbol, amount: balances[i]!, decimals };
      }),
    );
    out.push({ id, eth, assets, sealedUntil: Number(sealed) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** /legacy: PRISM v1 crystal holders get everything back in one transaction. Not in the nav. */
export default function Legacy() {
  const { address, isConnected, onTarget } = useWallet();
  const q = useQuery({ queryKey: ['legacy-crystals', address], enabled: !!address, queryFn: () => readCrystals(address!), staleTime: 30_000 });
  const d = legacy();
  return (
    <PageScroll>
      <PageHeader
        label="PRISM v1 · archived"
        lead="Your v1"
        accent="crystals."
        subtitle="PRISM v1 turned test stocks and ETH into crystals. It’s archived now, but your crystals and everything inside them are still yours, on-chain."
        guide={
          <GuideNote index={2}>
            Empty a crystal to get every token and the ETH inside back to your wallet in one transaction. The crystal is burned when it’s emptied. Nobody else can
            do this for you, and nobody can stop you.{' '}
            {d && (
              <a href={`${explorerAddressUrl(d.prismCrystal)}#code`} target="_blank" rel="noreferrer" className="text-lime hover:underline">
                The v1 contract ↗
              </a>
            )}
          </GuideNote>
        }
      />
      {!isConnected || !address ? (
        <WalletButton variant="hero" />
      ) : q.isError ? (
        <GuideNote index={3}>Couldn’t read your crystals right now. Try again in a minute.</GuideNote>
      ) : !q.data ? (
        <p className="text-mist">Looking for your crystals…</p>
      ) : q.data.length === 0 ? (
        <GuideNote index={3} action={<Link to="/" className="btn btn-primary">See the new PRISM</Link>}>
          This wallet holds no v1 crystals. Nothing to do here.
        </GuideNote>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {q.data.map((c) => (
            <CrystalRow key={c.id.toString()} crystal={c} owner={address} onTarget={onTarget} />
          ))}
        </ul>
      )}
    </PageScroll>
  );
}

function CrystalRow({ crystal: c, owner, onTarget }: { crystal: Crystal; owner: Address; onTarget: boolean }) {
  const tx = useTxSteps();
  const qc = useQueryClient();
  const now = Math.floor(Date.now() / 1000);
  const sealed = c.sealedUntil > now;
  const empty = c.eth === 0n && c.assets.every((a) => a.amount === 0n);
  const d = legacy()!;
  const burn = async () => {
    const ok = await tx.run([
      {
        label: `Emptying crystal #${c.id}`,
        tx: { description: `Send everything inside PRISM v1 crystal #${c.id} back to your wallet and burn the crystal.`, action: 'Empty & burn', contract: 'PrismCrystal (v1)' },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, { address: d.prismCrystal, abi: crystalAbi, functionName: 'withdrawAllAndBurn', args: [c.id, owner], chainId: TARGET_CHAIN.id, account: owner });
          return write(request);
        },
      },
    ]);
    if (ok) {
      void qc.invalidateQueries({ queryKey: ['legacy-crystals'] });
      void qc.invalidateQueries({ queryKey: ['balance'] });
    }
  };
  return (
    <li className="card flex flex-col gap-4 p-5">
      <p className="font-display text-xl font-bold">Crystal #{c.id.toString()}</p>
      <ul className="flex flex-col gap-1 text-[14px]">
        {c.assets.map((a) => (
          <li key={a.token} className="flex justify-between gap-3">
            <span className="text-mist">${a.symbol}</span>
            <span className="font-mono text-white">{formatTokens(a.amount, a.decimals)}</span>
          </li>
        ))}
        {c.eth > 0n && (
          <li className="flex justify-between gap-3">
            <span className="text-mist">ETH</span>
            <span className="font-mono text-white">{Number(formatEther(c.eth)).toLocaleString('en-US', { maximumSignificantDigits: 4 })}</span>
          </li>
        )}
        {empty && <li className="text-mist">Empty.</li>}
      </ul>
      {sealed ? (
        <p className="text-[13px] text-gold">Sealed until {dateText(c.sealedUntil)}: it can be emptied from then on (a seal can’t be shortened, by anyone).</p>
      ) : !onTarget ? (
        <SwitchNetworkButton />
      ) : (
        <button type="button" className="btn btn-primary self-start" disabled={tx.running} onClick={() => void burn()}>
          {tx.running ? 'Working…' : 'Empty & burn'}
        </button>
      )}
      <StepList steps={tx.steps} />
    </li>
  );
}
