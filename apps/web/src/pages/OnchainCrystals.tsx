import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatUnits, type Address } from 'viem';
import { simulateContract, writeContract } from 'wagmi/actions';
import {
  BASKET_TOKENS,
  explorerAddressUrl,
  getDeployment,
  localDateTimeToUnix,
  parseTokenAmount,
  prismCrystalAbi,
  valueWeights,
  type Holding,
  type OwnedViber,
} from '@prism/core';
import { FittedCrystal } from '../components/Crystal';
import { ViberCredit, ViberGuide, useOwnedViber } from '../components/Viber';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage } from '../components/Stage';
import { Change, DataBadge, EthPrice, Panel } from '../components/ui';
import { useTestnetTokens, type LiveToken } from '../data/chain';
import { useMyCrystals, type OnchainCrystal } from '../data/crystals';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { DepositForm } from '../wallet/DepositForm';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, useWallet } from '../wallet/WalletButton';

const DEFAULT_VOLATILITY = 0.4;
type Tab = 'withdraw' | 'add' | 'seal' | 'burn';

const fmtAmount = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();

/** Real crystals of the connected wallet, read from the PrismCrystal contract. */
export default function OnchainCrystals() {
  const { address, onTarget } = useWallet();
  const deployment = getDeployment(TARGET_CHAIN.id);
  const crystals = useMyCrystals(address);
  const ownedViber = useOwnedViber(address);
  const live = useTestnetTokens();
  const [selectedId, setSelectedId] = useState<bigint | null>(null);

  const market = useMemo(() => {
    const m = new Map<string, LiveToken>();
    if (live.status === 'live') for (const t of live.tokens) m.set(t.address.toLowerCase(), t);
    return m;
  }, [live]);
  const weth = live.status === 'live' ? live.tokens.find((t) => t.id === 'WETH') : undefined;
  const marketOf = (token: Address | null) => (token ? market.get(token.toLowerCase()) : weth);

  const list = crystals.data ?? [];
  const selected = list.find((c) => c.id === selectedId) ?? list[0];

  const header = (
    <PageHeader title="My Crystals" subtitle="The crystals in your wallet and what is inside each one. Take things out, add more, or seal one as a gift.">
      <DataBadge live />
      {deployment && (
        <a className="font-mono text-[10px] text-mist hover:text-lime" href={explorerAddressUrl(deployment.prismCrystal)} target="_blank" rel="noreferrer">
          contract {deployment.prismCrystal.slice(0, 6)}…{deployment.prismCrystal.slice(-4)} ↗
        </a>
      )}
    </PageHeader>
  );

  if (!deployment) {
    return (
      <PageScroll className="max-w-3xl gap-4">
        {header}
        <Panel className="p-6 text-sm text-mist">
          The PrismCrystal contract isn’t deployed on Robinhood Chain Testnet yet, so there are no real crystals to show.
          Disconnect your wallet to browse the sample crystals.
        </Panel>
      </PageScroll>
    );
  }

  return (
    <PageScroll className="max-w-7xl gap-4">
      {header}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <button key={c.id.toString()} onClick={() => setSelectedId(c.id)} className={`chip ${selected?.id === c.id ? 'chip-on' : ''}`}>
              #{c.id.toString()}
              {c.sealedUntil * 1000 > Date.now() ? ' ❄' : ''}
            </button>
          ))}
        </div>
      </div>

      {!onTarget && <SwitchNetworkButton />}
      {crystals.isLoading && <p className="label text-mist">Reading your crystals from the chain…</p>}
      {crystals.isError && <p className="text-sm text-down">Couldn’t read crystals: {(crystals.error as Error).message.split('\n')[0]}</p>}
      {crystals.isSuccess && list.length === 0 && (
        <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <ViberGuide index={7}>No crystals in this wallet yet. Forge one — you can start with just ETH.</ViberGuide>
          <Link to="/forge" className="btn btn-primary">
            Forge your first crystal
          </Link>
        </Panel>
      )}

      {selected && (
        <CrystalView
          key={selected.id.toString()}
          viber={ownedViber.data}
          crystal={selected}
          marketOf={marketOf}
          owner={address!}
          contract={deployment.prismCrystal}
          onChanged={() => crystals.refetch()}
        />
      )}
      <ViberCredit />
    </PageScroll>
  );
}

function CrystalView(props: {
  viber?: OwnedViber | null;
  crystal: OnchainCrystal;
  marketOf: (token: Address | null) => LiveToken | undefined;
  owner: Address;
  contract: Address;
  onChanged: () => void;
}) {
  const { crystal, marketOf, viber } = props;
  const sealed = crystal.sealedUntil * 1000 > Date.now();
  const [tab, setTab] = useState<Tab>('withdraw');

  const rows = crystal.assets.map((a) => {
    const m = marketOf(a.token);
    const qty = Number(formatUnits(a.amount, a.decimals));
    const ethValue = m?.market.eth != null ? qty * m.market.eth : null;
    const usdValue = m?.market.usd != null ? qty * m.market.usd : null;
    return { a, m, ethValue, usdValue };
  });
  const weights = valueWeights(rows.map((r) => r.ethValue));
  const holdings: Holding[] = rows.map((r, i) => ({
    symbol: r.a.symbol,
    weight: weights[i]!,
    change24h: r.m?.market.change24h ?? Number.NaN,
    volatility: r.m?.market.volatility ?? DEFAULT_VOLATILITY,
  }));
  const totalEth = rows.reduce((s, r) => s + (r.ethValue ?? 0), 0);
  const totalUsd = rows.reduce((s, r) => s + (r.usdValue ?? 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <div className="relative h-[46vh] min-h-[300px] overflow-hidden rounded-lg border border-line">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
          {holdings.length > 0 && (
            <FittedCrystal holdings={holdings} size={1.6} spin={0.2} top={0.14} bottom={0.94} companion={viber} />
          )}
        </Stage>
        <div className="pointer-events-none absolute left-4 top-4 space-y-1">
          <p className="headline text-2xl">Crystal #{crystal.id.toString()}</p>
          {totalEth > 0 && <EthPrice eth={totalEth} usd={totalUsd || null} />}
          {sealed && <p className="label text-[#bfe6ff]">❄ Sealed until {fmtDate(crystal.sealedUntil)}</p>}
        </div>
        {viber && <ViberCredit className="pointer-events-auto absolute bottom-3 right-4" />}
      </div>

      <div className="space-y-4">
        <Panel className="p-4">
          <table className="w-full text-sm">
            <thead className="label text-left text-mist">
              <tr>
                <th className="pb-2 font-normal">Asset</th>
                <th className="pb-2 text-right font-normal">Amount</th>
                <th className="pb-2 text-right font-normal">Value</th>
                <th className="pb-2 text-right font-normal">24h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, m, ethValue, usdValue }) => (
                <tr key={a.token ?? 'eth'} className="border-t border-line">
                  <td className="py-2 font-medium">{a.symbol}</td>
                  <td className="py-2 text-right font-mono">{fmtAmount(a.amount, a.decimals)}</td>
                  <td className="py-2 text-right">{ethValue !== null ? <EthPrice eth={ethValue} usd={usdValue} /> : <span className="text-xs text-mist">no price</span>}</td>
                  <td className="py-2 text-right text-xs">
                    {m?.market.change24h != null ? <Change value={m.market.change24h} /> : <span className="text-mist">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel className="p-4">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(['withdraw', 'add', 'seal', 'burn'] as const).map((t) => (
              <button key={t} className={`chip ${tab === t ? 'chip-on' : ''}`} onClick={() => setTab(t)}>
                {t === 'burn' ? 'Empty & burn' : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <p className="mb-4 text-sm text-mist">{TAB_HELP[tab]}</p>
          {tab === 'withdraw' && <WithdrawForm {...props} sealed={sealed} />}
          {tab === 'add' && <AddForm {...props} />}
          {tab === 'seal' && <SealForm {...props} />}
          {tab === 'burn' && <BurnForm {...props} sealed={sealed} />}
        </Panel>
      </div>
    </div>
  );
}

const TAB_HELP: Record<Tab, string> = {
  withdraw: 'Take some or all of the tokens out of this crystal and back into your wallet.',
  add: 'Put more tokens or ETH into this crystal. It keeps everything it already holds.',
  seal: 'Lock this crystal until a date, like a wrapped gift. You can still send it to someone.',
  burn: 'Take everything out and destroy the crystal. Use this when you are done with it.',
};

type FormProps = { crystal: OnchainCrystal; owner: Address; contract: Address; onChanged: () => void };

function SealedNotice({ crystal }: { crystal: OnchainCrystal }) {
  return (
    <p className="rounded border border-[#bfe6ff]/40 bg-[#bfe6ff]/10 p-3 text-sm text-[#d9f1ff]">
      ❄ Sealed until {fmtDate(crystal.sealedUntil)}. Nothing can be withdrawn before then — not even by you.
    </p>
  );
}

function WithdrawForm({ crystal, owner, contract, onChanged, sealed }: FormProps & { sealed: boolean }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const { steps, running, run } = useTxSteps();
  if (sealed) return <SealedNotice crystal={crystal} />;

  const parsed = crystal.assets.map((a) => {
    const raw = inputs[a.token ?? 'eth'] ?? '';
    const amt = raw === '' ? 0n : parseTokenAmount(raw, a.decimals);
    return { a, raw, amt };
  });
  const problems = parsed.flatMap(({ a, raw, amt }) =>
    raw === '' ? [] : amt === null ? [`Invalid amount for ${a.symbol}.`] : amt > a.amount ? [`The crystal holds only ${fmtAmount(a.amount, a.decimals)} ${a.symbol}.`] : [],
  );
  const chosen = parsed.filter((p) => p.amt && p.amt > 0n && p.amt <= p.a.amount);
  const tokens = chosen.filter((p) => p.a.token).map((p) => p.a.token!);
  const amounts = chosen.filter((p) => p.a.token).map((p) => p.amt!);
  const eth = chosen.find((p) => !p.a.token)?.amt ?? 0n;

  const go = async () => {
    const ok = await run([
      {
        label: `Withdrawing from crystal #${crystal.id}`,
        send: async () => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'withdraw',
            args: [crystal.id, tokens, amounts, eth, owner],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return writeContract(wagmiConfig, request);
        },
      },
    ]);
    if (ok) {
      setInputs({});
      onChanged();
    }
  };

  return (
    <div className="space-y-3">
      {parsed.map(({ a, raw }) => (
        <label key={a.token ?? 'eth'} className="block">
          <span className="mb-1 flex justify-between text-xs">
            <span className="text-white">{a.symbol}</span>
            <span className="font-mono text-mist">in crystal: {fmtAmount(a.amount, a.decimals)}</span>
          </span>
          <span className="flex gap-2">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={raw}
              disabled={running}
              onChange={(e) => setInputs((s) => ({ ...s, [a.token ?? 'eth']: e.target.value }))}
              className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm outline-none focus:border-lime/60"
            />
            <button className="chip" disabled={running} onClick={() => setInputs((s) => ({ ...s, [a.token ?? 'eth']: formatUnits(a.amount, a.decimals) }))}>
              Max
            </button>
          </span>
        </label>
      ))}
      {problems.map((p) => (
        <p key={p} className="text-xs text-down">· {p}</p>
      ))}
      <p className="text-xs text-mist">Sends to your connected wallet ({owner.slice(0, 6)}…{owner.slice(-4)}).</p>
      <button className="btn btn-primary w-full" disabled={running || chosen.length === 0 || problems.length > 0} onClick={go}>
        {running ? 'Working…' : 'Withdraw'}
      </button>
      <StepList steps={steps} />
    </div>
  );
}

function AddForm({ crystal, contract, onChanged }: FormProps) {
  const held = new Set(crystal.assets.map((a) => a.token?.toLowerCase()));
  const [picked, setPicked] = useState<string[]>([]);
  const tokens = BASKET_TOKENS.filter((t) => picked.includes(t.id));
  const newAssets = tokens.filter((t) => !held.has(t.address.toLowerCase())).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {BASKET_TOKENS.map((t) => (
          <button
            key={t.id}
            className={`chip ${picked.includes(t.id) ? 'chip-on' : ''}`}
            onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : [...p, t.id]))}
          >
            {t.id}
          </button>
        ))}
      </div>
      <DepositForm
        key={picked.join(',')}
        crystal={contract}
        tokens={tokens}
        target={{ kind: 'add', id: crystal.id }}
        // assets already in the crystal (topping up one doesn't use a new slot)
        existingAssets={crystal.assets.length - (tokens.length - newAssets)}
        onDone={onChanged}
      />
    </div>
  );
}

function SealForm({ crystal, owner, contract, onChanged }: FormProps) {
  const [value, setValue] = useState('');
  const [ack, setAck] = useState(false);
  const { steps, running, run } = useTxSteps();
  const unlock = localDateTimeToUnix(value);
  const now = Math.floor(Date.now() / 1000);
  const problem =
    unlock === null
      ? null
      : unlock <= now
        ? 'Pick a time in the future.'
        : unlock <= crystal.sealedUntil
          ? `A seal can only be extended — pick a time after ${fmtDate(crystal.sealedUntil)}.`
          : unlock > now + 100 * 365 * 86400
            ? 'Seals are limited to 100 years.'
            : null;
  const minLocal = new Date(Math.max(now, crystal.sealedUntil) * 1000 + 60_000 - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);

  const go = async () => {
    const ok = await run([
      {
        label: `Sealing crystal #${crystal.id}`,
        send: async () => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'seal',
            args: [crystal.id, BigInt(unlock!)],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return writeContract(wagmiConfig, request);
        },
      },
    ]);
    if (ok) onChanged();
  };

  return (
    <div className="space-y-3">
      <p className="rounded border border-down/50 bg-down/10 p-3 text-sm text-[#ffd0cf]">
        <b>A seal can’t be shortened or removed — by anyone, including you.</b> Until the date you pick, nothing can be
        withdrawn from this crystal. It can still be transferred (that’s how a sealed gift is sent), and you can extend
        the seal later.
      </p>
      {crystal.sealedUntil > 0 && <p className="text-xs text-mist">Current seal: {fmtDate(crystal.sealedUntil)}</p>}
      <label className="block text-xs text-mist">
        Unlock date and time (your local time)
        <input
          type="datetime-local"
          min={minLocal}
          value={value}
          disabled={running}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm text-white outline-none focus:border-lime/60 [color-scheme:dark]"
        />
      </label>
      {problem && <p className="text-xs text-down">· {problem}</p>}
      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#d4f000]" />
        I understand the crystal stays locked until {unlock ? fmtDate(unlock) : 'that date'} and this can’t be undone.
      </label>
      <button className="btn btn-primary w-full" disabled={running || !unlock || !!problem || !ack} onClick={go}>
        {running ? 'Working…' : 'Seal crystal'}
      </button>
      <StepList steps={steps} />
    </div>
  );
}

function BurnForm({ crystal, owner, contract, onChanged, sealed }: FormProps & { sealed: boolean }) {
  const [ack, setAck] = useState(false);
  const { steps, running, run } = useTxSteps();
  if (sealed) return <SealedNotice crystal={crystal} />;
  const go = async () => {
    const ok = await run([
      {
        label: `Emptying and burning crystal #${crystal.id}`,
        send: async () => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'withdrawAllAndBurn',
            args: [crystal.id, owner],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return writeContract(wagmiConfig, request);
        },
      },
    ]);
    if (ok) onChanged();
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-mist">Everything inside goes back to your wallet, then the crystal is destroyed for good.</p>
      <label className="flex items-start gap-2 text-xs text-mist">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#d4f000]" />
        Burn crystal #{crystal.id.toString()} after emptying it.
      </label>
      <button className="btn btn-secondary w-full" disabled={running || !ack} onClick={go}>
        {running ? 'Working…' : 'Empty & burn'}
      </button>
      <StepList steps={steps} />
    </div>
  );
}
