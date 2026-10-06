import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { formatUnits, type Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import {
  BASKET_TOKENS,
  getDeployment,
  holdingShades,
  localDateTimeToUnix,
  normalizeHoldings,
  opensIn,
  parseTokenAmount,
  prismCrystalAbi,
  valueWeights,
  atName,
  type CrystalHistory,
  type Gift,
  type Holding,
} from '@prism/core';
import { AssetDots } from '../components/AssetDots';
import { FittedCrystal } from '../components/Crystal';
import { CrystalThumb } from '../components/CrystalThumb';
import { GiftCard, GiftIcon } from '../components/GiftCard';
import { SHARE, ShareOnX } from '../components/ShareOnX';
import { GuideNote } from '../components/Viber';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage } from '../components/Stage';
import { Change, EthPrice, formatEth } from '../components/ui';
import { LoadingStage } from '../components/LoadingStage';
import { useTestnetTokens, type LiveToken } from '../data/chain';
import { realCrystalHistory } from '../data/crystalHoldings';
import { valueCrystal, type MarketOf, type Valued } from '../data/crystalValue';
import { earliestForge, useMyCrystals, type OnchainCrystal } from '../data/crystals';
import { useGiftNote, useNow, useOpenedGifts, useReceivedGifts } from '../data/gifts';
import { OwnerChip, shortAddress, useProfile, useProfiles, type Profile } from '../data/profiles';
import { ClaimBanner } from '../components/ClaimBanner';
import { TARGET_CHAIN, wagmiConfig } from '../wallet/config';
import { DepositForm } from '../wallet/DepositForm';
import { GiftForm, type SentGift } from '../wallet/GiftForm';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, useWallet } from '../wallet/WalletButton';

type Tab = 'holdings' | 'withdraw' | 'add' | 'seal' | 'gift' | 'burn';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'holdings', label: 'Holdings' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'add', label: 'Add' },
  { id: 'seal', label: 'Seal' },
  { id: 'gift', label: 'Gift' },
  { id: 'burn', label: 'Burn' },
];

const fmtAmount = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleString();
const isSealed = (c: OnchainCrystal) => c.sealedUntil * 1000 > Date.now();


/** What the page lets you do, shown while there is nothing of yours to show yet. */
export function WhatYouCanDo() {
  const items = [
    { t: 'Holdings', d: 'See every token inside each crystal and what it is worth in ETH.' },
    { t: 'Withdraw & add', d: 'Take tokens out to your wallet, or put more in. Only you can.' },
    { t: 'Seal & gift', d: 'Lock a crystal until a date, or give it to someone with a note.' },
    { t: 'Burn', d: 'Empty everything back to your wallet and retire the crystal.' },
  ];
  return (
    <section aria-label="What you can do here" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.t} className="card p-6">
          <p className="font-display text-xl font-bold">{i.t}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-mist">{i.d}</p>
        </div>
      ))}
    </section>
  );
}

/** Real crystals of the connected wallet, read from the PrismCrystal contract. */
export default function OnchainCrystals() {
  const { address, onTarget } = useWallet();
  const deployment = getDeployment(TARGET_CHAIN.id);
  const crystals = useMyCrystals(address);
  const { profile } = useProfile(address);
  // price history must reach back to the oldest crystal's forge block
  const live = useTestnetTokens(earliestForge(crystals.data));
  // ?id=N (from a profile's crystal grid) opens that crystal
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<bigint | null>(() => (/^\d+$/.test(params.get('id') ?? '') ? BigInt(params.get('id')!) : null));

  const market = useMemo(() => {
    const m = new Map<string, LiveToken>();
    if (live.status === 'live') for (const t of live.tokens) m.set(t.address.toLowerCase(), t);
    return m;
  }, [live]);
  const weth = live.status === 'live' ? live.tokens.find((t) => t.id === 'WETH') : undefined;
  const marketOf = useMemo<MarketOf>(() => (token) => (token ? market.get(token.toLowerCase()) : weth), [market, weth]);

  const list = useMemo(() => crystals.data ?? [], [crystals.data]);
  const selected = list.find((c) => c.id === selectedId) ?? list[0];
  const valued = useMemo(() => new Map(list.map((c) => [c.id, valueCrystal(c, marketOf)])), [list, marketOf]);
  const histories = useMemo(() => new Map(list.map((c) => [c.id, realCrystalHistory(live, c)])), [list, live]);

  // gifts: one you just sent, and the ones you received (wrapped until you unwrap them)
  const queryClient = useQueryClient();
  const [sent, setSent] = useState<SentGift | null>(null);
  const received = useReceivedGifts(address);
  const opened = useOpenedGifts(address);
  const senders = useProfiles([...received.gifts.values()].map((g) => g.from));
  const now = useNow();
  const onGifted = (g: SentGift) => {
    setSent(g);
    crystals.refetch();
    queryClient.invalidateQueries({ queryKey: ['crystal-events'] });
    queryClient.invalidateQueries({ queryKey: ['all-crystals'] });
  };
  const giftFor = (c: OnchainCrystal) => {
    const g = received.gifts.get(c.id);
    if (!g) return undefined;
    const sender = senders.get(g.from.toLowerCase());
    return { gift: g, sender, fromLabel: sender?.name ? atName(sender.name) : shortAddress(g.from), wrapped: opened.isWrapped(c.id), open: () => opened.markOpened(c.id) };
  };

  const empty = crystals.isSuccess && list.length === 0;
  const guide = !deployment ? (
    <GuideNote index={7}>The PRISM contract isn’t deployed on Robinhood Chain Testnet yet, so there are no crystals to show.</GuideNote>
  ) : empty ? (
    <GuideNote
      index={7}
      action={
        <Link to="/forge" className="btn btn-primary">
          Forge your first crystal
        </Link>
      }
    >
      No crystals in this wallet yet. Forge one: you can start with just ETH.
    </GuideNote>
  ) : undefined;

  const header = (
    <PageHeader
      label="My crystals"
      lead="Your"
      accent="crystals."
      subtitle="The crystals in your wallet and what is inside each one. Take things out, add more, or give one as a gift."
      guide={guide}
    />
  );

  if (!deployment) return <PageScroll>{header}</PageScroll>;

  const totalEth = [...valued.values()].reduce((s, v) => s + v.totalEth, 0);
  const best = list
    .map((c) => ({ c, ch: valued.get(c.id)!.change24h }))
    .filter((x): x is { c: OnchainCrystal; ch: number } => x.ch != null)
    .sort((a, b) => b.ch - a.ch)[0];
  const priced = live.status === 'live';

  return (
    <PageScroll>
      {header}
      {!onTarget && <SwitchNetworkButton />}
      {sent && (
        <section aria-live="polite" className="flex flex-wrap items-center gap-4 rounded-[20px] border border-lime/40 bg-lime/[0.06] p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-lime/40 text-lime">
            <GiftIcon size={20} />
          </span>
          <p className="min-w-0 flex-1 text-white">
            Sent! Crystal #{sent.id.toString()} now belongs to <b>{sent.toLabel}</b>.
          </p>
          <div className="flex flex-wrap gap-3">
            <ShareOnX text={SHARE.gift(sent.id)} className="btn btn-primary" />
            <Link to={`/gift/${sent.id}`} className="btn btn-outline">
              See the gift page
            </Link>
          </div>
        </section>
      )}
      {list.length > 0 && address && <ClaimBanner address={address} />}
      {crystals.isLoading && <LoadingStage label="Reading your crystals from the chain…" />}
      {crystals.isError && <p className="text-sm text-down">Couldn’t read crystals: {(crystals.error as Error).message.split('\n')[0]}</p>}
      {empty && <WhatYouCanDo />}

      {list.length > 0 && (
        <>
          <section aria-label="Summary" className="grid grid-cols-3 gap-3 sm:gap-6">
            <Stat label={list.length === 1 ? 'Crystal' : 'Crystals'} value={String(list.length)} />
            <Stat
              label={
                <>
                  <span className="sm:hidden">Value</span>
                  <span className="hidden sm:inline">Total value</span>
                </>
              }
              value={
                priced ? (
                  <>
                    {formatEth(totalEth).replace(' ETH', '')}
                    <span className="ml-1 font-mono text-[10px] font-normal text-mist sm:text-xs">ETH</span>
                  </>
                ) : (
                  '…'
                )
              }
            />
            <Stat
              label="Best 24h"
              value={
                best ? (
                  <>
                    <Change value={best.ch} /> <span className="font-mono text-xs text-mist">#{best.c.id.toString()}</span>
                  </>
                ) : (
                  '…'
                )
              }
            />
          </section>

          <div className="grid grid-cols-12 gap-6">
            <aside className="col-span-12 min-w-0 lg:col-span-4">
              {/* phones: a horizontal scroller; desktop: a vertical list that stays in view */}
              <ul className="no-scrollbar -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 lg:sticky lg:top-28 lg:mx-0 lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:px-0">
                {list.map((c) => (
                  <li key={c.id.toString()} className="w-[240px] shrink-0 snap-start lg:w-auto">
                    <CrystalCard
                      crystal={c}
                      valued={valued.get(c.id)!}
                      history={histories.get(c.id)}
                      priced={priced}
                      active={selected?.id === c.id}
                      onSelect={() => setSelectedId(c.id)}
                      gift={giftFor(c)}
                      now={now}
                    />
                  </li>
                ))}
              </ul>
            </aside>
            <div className="col-span-12 min-w-0 lg:col-span-8">
              {selected && (
                <CrystalView
                  key={selected.id.toString()}
                  crystal={selected}
                  valued={valued.get(selected.id)!}
                  history={histories.get(selected.id)}
                  owner={address!}
                  ownerProfile={profile}
                  contract={deployment.prismCrystal}
                  onChanged={() => crystals.refetch()}
                  onGifted={onGifted}
                  gift={giftFor(selected)}
                  now={now}
                />
              )}
            </div>
          </div>
        </>
      )}
    </PageScroll>
  );
}

function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="card min-w-0 px-4 py-4 sm:px-6 sm:py-5">
      <p className="section-label truncate text-[10px] sm:text-[11px]">{label}</p>
      <p className="mt-2 truncate font-display text-base font-bold tracking-[-0.02em] sm:text-2xl">{value}</p>
    </div>
  );
}

/** A received gift as the page shows it: who sent it, and whether it's still wrapped here. */
interface ReceivedGift {
  gift: Gift;
  sender?: Profile;
  fromLabel: string;
  wrapped: boolean;
  open: () => void;
}

function CrystalCard(props: {
  crystal: OnchainCrystal;
  valued: Valued;
  history?: CrystalHistory;
  priced: boolean;
  active: boolean;
  onSelect: () => void;
  gift?: ReceivedGift;
  now: number;
}) {
  const { crystal, valued, history, priced, active, onSelect, gift, now } = props;
  const sealed = isSealed(crystal);
  // a gift still in its wrapping shows frosted, like a sealed one
  const iced = sealed || !!gift?.wrapped;
  const left = sealed && gift ? opensIn(crystal.sealedUntil, now) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full flex-col gap-3 rounded-[20px] border p-3 text-left transition-colors ${
        active ? 'border-lime/50 bg-lime/[0.05]' : 'border-white/[0.08] bg-panel hover:border-white/20'
      }`}
    >
      <span className="flex w-full items-center gap-4">
        <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-2xl bg-ink">
          <CrystalThumb holdings={valued.holdings} history={history} sealed={iced} size={64} />
        </span>
        <span className="min-w-0 flex-1">
          {gift && (
            <span className="mb-1 flex items-center gap-1.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[#bfe6ff]">
              <GiftIcon size={12} />
              <span className="truncate normal-case tracking-normal">Gift from {gift.fromLabel}</span>
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className="font-display text-lg font-bold">#{crystal.id.toString()}</span>
            {sealed && (
              <span title={`Sealed until ${fmtDate(crystal.sealedUntil)}`} className="text-[#bfe6ff]" aria-label="Sealed">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <rect x="5" y="10.5" width="14" height="10" rx="2" />
                  <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                </svg>
              </span>
            )}
          </span>
          <span className="mt-1 block font-mono text-xs text-white">{priced ? formatEth(valued.totalEth) : '…'}</span>
          <span className="mt-0.5 block text-xs">
            {left ? (
              <span className="text-[#bfe6ff]">❄ {left}</span>
            ) : gift?.wrapped ? (
              <span className="text-lime">Ready to unwrap</span>
            ) : valued.change24h != null ? (
              <>
                <Change value={valued.change24h} /> <span className="text-mist">24h</span>
              </>
            ) : (
              <span className="text-mist">
                {crystal.assets.length} asset{crystal.assets.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </span>
      </span>
      {/* the key to the thumbnail's colours */}
      <AssetDots holdings={valued.holdings} sealed={iced} className="px-1 pb-0.5" />
    </button>
  );
}

function CrystalView(props: {
  crystal: OnchainCrystal;
  valued: Valued;
  history?: CrystalHistory;
  owner: Address;
  ownerProfile: Profile;
  contract: Address;
  onChanged: () => void;
  onGifted: (gift: SentGift) => void;
  gift?: ReceivedGift;
  now: number;
}) {
  const { crystal, valued, history, gift, now } = props;
  const sealed = isSealed(crystal);
  const [tab, setTab] = useState<Tab>('holdings');
  const form = { crystal, owner: props.owner, ownerProfile: props.ownerProfile, contract: props.contract, onChanged: props.onChanged };
  // a received gift: the note comes from the gift transaction; it stays wrapped until unwrapped
  const note = useGiftNote(gift?.gift);
  const [unwrapping, setUnwrapping] = useState(false);
  const wrapped = !!gift?.wrapped;
  const canUnwrap = wrapped && !sealed;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-bold tracking-[-0.03em]">Crystal #{crystal.id.toString()}</h2>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-mist">
            owner <OwnerChip address={props.owner} profile={props.ownerProfile} size={18} className="text-white" />
          </p>
          {sealed && <p className="label mt-2 text-[#bfe6ff]">Sealed until {fmtDate(crystal.sealedUntil)}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {valued.totalEth > 0 && <EthPrice eth={valued.totalEth} usd={valued.totalUsd || null} />}
          <Link to={`/replay/${crystal.id}`} className="btn btn-outline">
            ▶ Replay
          </Link>
        </div>
      </div>
      {gift && (
        <GiftCard
          label="A gift from"
          who={gift.gift.from}
          profile={gift.sender}
          note={note.data ?? null}
          noteLoading={note.isLoading}
          unlock={sealed ? crystal.sealedUntil : 0}
          now={now}
          opened={!wrapped}
        >
          {canUnwrap && (
            <button type="button" className="btn btn-primary" disabled={unwrapping} onClick={() => setUnwrapping(true)}>
              {unwrapping ? 'Unwrapping…' : 'Unwrap'}
            </button>
          )}
        </GiftCard>
      )}
      <div className="relative h-[320px] overflow-hidden rounded-[24px] border border-white/[0.08] sm:h-[420px]">
        <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
          {valued.holdings.length > 0 && (
            <FittedCrystal
              holdings={valued.holdings}
              history={history}
              sealed={sealed || wrapped}
              unwrapping={unwrapping}
              onUnwrapped={() => {
                gift?.open();
                setUnwrapping(false);
              }}
              size={1.6}
              spin={0.2}
              top={0.08}
              bottom={0.92}
            />
          )}
        </Stage>
      </div>

      <div className="card p-5 sm:p-6">
        <div role="tablist" aria-label="Crystal actions" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`label shrink-0 rounded-full px-2.5 py-2 text-[10px] !tracking-[0.08em] transition-colors sm:px-4 sm:text-[11px] sm:!tracking-[0.16em] ${
                tab === t.id ? 'bg-lime text-ink' : 'text-mist hover:bg-white/5 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm text-mist">{TAB_HELP[tab]}</p>
        <div className="mt-5" role="tabpanel">
          {tab === 'holdings' && <HoldingsList valued={valued} />}
          {tab === 'withdraw' && <WithdrawForm {...form} sealed={sealed} />}
          {tab === 'add' && <AddForm {...form} />}
          {tab === 'seal' && <SealForm {...form} />}
          {tab === 'gift' && (
            <GiftForm
              crystal={crystal}
              owner={props.owner}
              ownerProfile={props.ownerProfile}
              contract={props.contract}
              holdings={valued.holdings}
              history={history}
              onSent={props.onGifted}
            />
          )}
          {tab === 'burn' && <BurnForm {...form} sealed={sealed} />}
        </div>
      </div>
    </div>
  );
}

function HoldingsList({ valued }: { valued: Valued }) {
  // each row's colour in the crystal above
  const colorOf = useMemo(() => new Map(holdingShades(normalizeHoldings(valued.holdings)).map((x) => [x.symbol, x.color])), [valued.holdings]);
  return (
    <ul className="divide-y divide-white/[0.06]">
      {valued.rows.map(({ a, m, ethValue, usdValue }, i) => (
        <li key={a.token ?? 'eth'} className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-lg font-bold">
              {colorOf.has(a.symbol) && (
                <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/70" style={{ background: colorOf.get(a.symbol) }} />
              )}
              {a.symbol} <span className="font-mono text-xs font-normal text-mist">{Math.round((valued.holdings[i]?.weight ?? 0) * 100)}%</span>
            </p>
            <p className="font-mono text-xs text-mist">{fmtAmount(a.amount, a.decimals)}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            {ethValue !== null ? <EthPrice eth={ethValue} usd={usdValue} /> : <span className="text-xs text-mist">no price</span>}
            <span className="text-xs">
              {m?.market.change24h != null ? (
                <>
                  <Change value={m.market.change24h} /> <span className="text-mist">24h</span>
                </>
              ) : (
                <span className="text-mist">—</span>
              )}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const TAB_HELP: Record<Tab, string> = {
  holdings: 'Everything inside this crystal, valued at live testnet prices.',
  withdraw: 'Take some or all of the tokens out of this crystal and back into your wallet.',
  add: 'Put more tokens or ETH into this crystal. It keeps everything it already holds.',
  seal: 'Lock this crystal until a date, like a wrapped gift. You can still send it to someone.',
  gift: 'Give this crystal to someone: an @username or a 0x address, with an optional note and opening date.',
  burn: 'Take everything out and destroy the crystal. Use this when you are done with it.',
};

type FormProps = { crystal: OnchainCrystal; owner: Address; ownerProfile?: Profile; contract: Address; onChanged: () => void };

function SealedNotice({ crystal }: { crystal: OnchainCrystal }) {
  return (
    <p className="rounded border border-[#bfe6ff]/40 bg-[#bfe6ff]/10 p-3 text-sm text-[#d9f1ff]">
      Sealed until {fmtDate(crystal.sealedUntil)}. Nothing can be withdrawn before then — not even by you.
    </p>
  );
}

function WithdrawForm({ crystal, owner, ownerProfile, contract, onChanged, sealed }: FormProps & { sealed: boolean }) {
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
        tx: { description: `Take what you picked out of crystal #${crystal.id}, back to your wallet.`, action: 'Withdraw', contract: 'PrismCrystal' },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'withdraw',
            args: [crystal.id, tokens, amounts, eth, owner],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return write(request);
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
      <p className="text-xs text-mist">
        Sends to your connected wallet: <OwnerChip address={owner} profile={ownerProfile} size={16} className="text-white" />
      </p>
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
        tx: {
          description: `Seal crystal #${crystal.id}: nothing can be taken out before the date you picked, not even by you. A seal can't be shortened.`,
          action: 'Seal crystal',
          contract: 'PrismCrystal',
        },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'seal',
            args: [crystal.id, BigInt(unlock!)],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return write(request);
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
        tx: {
          description: `Send everything in crystal #${crystal.id} back to your wallet and burn the crystal. This can't be undone.`,
          action: 'Empty and burn',
          contract: 'PrismCrystal',
        },
        send: async (write) => {
          const { request } = await simulateContract(wagmiConfig, {
            address: contract,
            abi: prismCrystalAbi,
            functionName: 'withdrawAllAndBurn',
            args: [crystal.id, owner],
            chainId: TARGET_CHAIN.id,
            account: owner,
          });
          return write(request);
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
