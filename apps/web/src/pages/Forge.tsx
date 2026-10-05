import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { useBalance, useReadContracts } from 'wagmi';
import {
  BASKET_TOKENS,
  GAS_RESERVE_WEI,
  ROUTER_TOKENS,
  getDeployment,
  normalizeTo100,
  parseTokenAmount,
  planDeposit,
  valueWeights,
  type Holding,
  type TestnetToken,
  type TokenMarket,
} from '@prism/core';
import { motion } from 'motion/react';
import { EASE } from '../components/design';
import { FittedCrystal } from '../components/Crystal';
import { PageHeader, PageScroll } from '../components/PageHeader';
import { Stage } from '../components/Stage';
import { Change, EthPrice, formatEth } from '../components/ui';
import { GuideNote } from '../components/Viber';
import { ClaimBanner } from '../components/ClaimBanner';
import { Logo } from '../components/Nav';
import { DEFAULT_VOLATILITY } from '../data/crystalHoldings';
import { useTestnetTokens, type LiveToken } from '../data/chain';
import { TARGET_CHAIN } from '../wallet/config';
import { depositSteps } from '../wallet/deposit';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton, useWallet } from '../wallet/WalletButton';
import { EthAmounts, EthReview, ethMixProblems, useEthForge, useEthMix } from './forge/EthMode';

const MAX_ASSETS = 8;

/** Token groups on the Pick step, in this order. */
const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Stocks', ids: ['AAPL', 'NVDA', 'SPCX'] },
  { label: 'Pre-IPO', ids: ['ANTHROPIC', 'OPENAI'] },
  { label: 'Crypto', ids: ['WETH'] },
];
const STEPS = ['Start', 'Pick', 'Amounts', 'Review'] as const;
/** Tokens "Start with ETH" can swap into (the router's fixed list). */
const ROUTER_IDS = new Set(ROUTER_TOKENS.map((t) => t.id));

/** Every basket token in Pick-step order (grouped first, anything else after). */
const ORDERED = [
  ...GROUPS.flatMap((g) => g.ids.map((id) => BASKET_TOKENS.find((t) => t.id === id)).filter((t): t is TestnetToken => !!t)),
  ...BASKET_TOKENS.filter((t) => !GROUPS.some((g) => g.ids.includes(t.id))),
];

/** Card subtitle: the token's on-chain name, spelled out where that name is just the symbol. */
const describe = (t: TestnetToken) => (t.id === 'WETH' ? 'Wrapped ETH (testnet, no value)' : t.name);

const fmt = (v: bigint, d: number) => {
  const n = Number(formatUnits(v, d));
  return n === 0 ? '0' : n < 0.0001 ? '<0.0001' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
};

/** True on wide screens (the two-column layout with the sticky preview). */
function useIsDesktop() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** A big either/or card for the Start step. */
function ModeCard({ on, title, text, soon, onClick }: { on: boolean; title: string; text: string; soon?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={soon}
      onClick={onClick}
      className={`card min-w-0 p-6 text-left md:p-8 ${soon ? 'cursor-not-allowed opacity-60' : 'card-hover'} ${on ? '!border-lime/70 !bg-lime/[0.05]' : ''}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-display text-2xl font-bold tracking-[-0.02em]">
          {title}
          {soon && (
            <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 align-middle font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">
              Soon
            </span>
          )}
        </span>
        <span className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on ? 'border-lime' : 'border-white/25'}`}>
          {on && <span className="h-2.5 w-2.5 rounded-full bg-lime" />}
        </span>
      </span>
      <span className="mt-3 block text-[15px] leading-relaxed text-mist">{text}</span>
    </button>
  );
}

function TokenCard({
  token: t,
  market: m,
  loading,
  on,
  balance,
  onToggle,
}: {
  token: TestnetToken;
  market?: TokenMarket;
  loading: boolean;
  on: boolean;
  /** undefined = no wallet connected; null = still reading */
  balance?: bigint | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`card card-hover min-w-0 p-6 text-left ${on ? '!border-lime/70 !bg-lime/[0.05]' : ''}`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-display text-2xl font-bold tracking-[-0.02em]">{t.id}</span>
        <span className={`grid h-6 w-6 place-items-center rounded-full border text-xs transition-colors ${on ? 'border-lime bg-lime text-ink' : 'border-white/25'}`}>
          {on ? '✓' : ''}
        </span>
      </span>
      <span className="mt-1 block truncate text-sm text-mist">{describe(t)}</span>
      <span className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {m?.eth ? <EthPrice eth={m.eth} usd={m.usd} /> : <span className="font-mono text-xs text-mist">{loading ? 'price…' : 'no price'}</span>}
        {m?.change24h != null && (
          <span className="text-xs">
            <Change value={m.change24h} /> <span className="text-mist">24h</span>
          </span>
        )}
      </span>
      {balance !== undefined && (
        <span className="mt-3 block font-mono text-[11px] text-mist">You own {balance === null ? '…' : fmt(balance, t.decimals)}</span>
      )}
    </button>
  );
}

interface SummaryItem {
  id: string;
  pct: number;
  eth: number | null;
}

/** The crystal preview's 3D view: the live crystal, or a prompt before anything is picked. */
function PreviewCrystal({ holdings, className }: { holdings: Holding[]; className: string }) {
  if (holdings.length === 0) {
    // no 3D canvas until there is something to show
    return (
      <div className={`flex flex-col items-center justify-center gap-4 bg-ink/40 px-8 text-center ${className}`}>
        <span className="opacity-40 grayscale">
          <Logo size={56} />
        </span>
        <p className="text-sm text-mist">Pick a token to see your crystal take shape.</p>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`}>
      <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
        <FittedCrystal holdings={holdings} size={1.6} spin={0.2} top={0.1} bottom={0.9} />
      </Stage>
    </div>
  );
}

/** What is in the crystal so far: each asset's share, its ETH value, and the total. */
function PreviewSummary({ items, total }: { items: SummaryItem[]; total: number | null }) {
  if (items.length === 0) return <p className="text-sm text-mist">Nothing picked yet.</p>;
  return (
    <div>
      <ul className="divide-y divide-white/[0.06]">
        {items.map((it) => (
          <li key={it.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
            <span className="font-bold">{it.id}</span>
            <span className="flex items-baseline gap-4">
              <span className="font-mono text-xs text-mist">{it.eth !== null && it.eth > 0 ? formatEth(it.eth) : '—'}</span>
              <span className="w-10 text-right font-mono text-lime">{it.pct}%</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.12] pt-3">
        <span className="section-label text-[11px]">Total</span>
        <span className="font-mono text-sm text-white">{total !== null && total > 0 ? formatEth(total) : '—'}</span>
      </div>
    </div>
  );
}

const LEGEND_LINE = 'Size = how much · colour = today’s move · spikes = how jumpy the price is';

/** Desktop: the sticky preview card in the right column. */
function PreviewCard({ holdings, items, total }: { holdings: Holding[]; items: SummaryItem[]; total: number | null }) {
  return (
    <div className="card overflow-hidden lg:sticky lg:top-28">
      <PreviewCrystal holdings={holdings} className="h-[300px] border-b border-white/[0.06] xl:h-[340px]" />
      <div className="p-6">
        <p className="section-label mb-3 text-[11px]">Your crystal</p>
        <PreviewSummary items={items} total={total} />
        <p className="mt-5 font-mono text-[10px] leading-relaxed text-mist/80">{LEGEND_LINE}</p>
      </div>
    </div>
  );
}

/** Phones: the preview folds into one line above the action bar; tap to open it. */
function PreviewFold({ holdings, items, total }: { holdings: Holding[]; items: SummaryItem[]; total: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span>
          <span className="section-label block text-[11px]">Your crystal</span>
          <span className="mt-1 block text-sm text-white">
            {items.length === 0 ? 'Nothing picked yet' : `${items.length} asset${items.length === 1 ? '' : 's'}`}
            {total !== null && total > 0 ? ` · ${formatEth(total)}` : ''}
          </span>
        </span>
        <span className="label text-[10px] text-lime">{open ? 'Hide' : 'Preview'}</span>
      </button>
      {open && (
        <>
          <PreviewCrystal holdings={holdings} className="h-[240px] border-y border-white/[0.06]" />
          <div className="p-5">
            <PreviewSummary items={items} total={total} />
          </div>
        </>
      )}
    </div>
  );
}

/** The wizard's sticky bottom bar: Back on the left, the next action on the right. */
function ActionBar({ back, status, children }: { back?: () => void; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-4 z-20 flex items-center gap-3 rounded-2xl border border-white/10 bg-panel/90 p-3 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)] backdrop-blur-md">
      {back ? (
        <button type="button" className="btn btn-outline shrink-0 !px-4" onClick={back}>
          ← Back
        </button>
      ) : null}
      {/* phones: no room for the status line beside two buttons (problems also show inline above) */}
      <p className="min-w-0 flex-1 truncate text-sm text-mist">
        <span className="hidden sm:inline">{status}</span>
      </p>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function Forge() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  const crystal = deployment?.prismCrystal;
  const router = deployment?.forgeRouter;
  const live = useTestnetTokens();
  const { address, isConnected, onTarget } = useWallet();
  const desktop = useIsDesktop();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [ethInput, setEthInput] = useState('');
  const [forgedId, setForgedId] = useState<bigint | null>(null);
  const tx = useTxSteps();

  const marketById = useMemo(() => {
    const m = new Map<string, LiveToken>();
    if (live.status === 'live') for (const t of live.tokens) m.set(t.id, t);
    return m;
  }, [live]);

  // wallet balances + allowances for every basket token (read-only)
  const reads = useReadContracts({
    contracts: BASKET_TOKENS.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN.id },
      { address: t.address, abi: erc20Abi, functionName: 'allowance', args: [address!, (crystal ?? t.address) as Address], chainId: TARGET_CHAIN.id },
    ]),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const balanceOf = (t: TestnetToken) => (reads.data?.[BASKET_TOKENS.indexOf(t) * 2]?.result as bigint | undefined) ?? null;
  const allowanceOf = (t: TestnetToken) => (reads.data?.[BASKET_TOKENS.indexOf(t) * 2 + 1]?.result as bigint | undefined) ?? 0n;
  const ethBal = useBalance({ address, chainId: TARGET_CHAIN.id, query: { enabled: !!address } });

  const balancesKnown = isConnected && reads.isSuccess;
  const ownsAnyStock = balancesKnown && BASKET_TOKENS.some((t) => t.kind !== 'crypto' && (balanceOf(t) ?? 0n) > 0n);

  // "Start with ETH" by default, but only once its router is deployed
  const [modeChoice, setModeChoice] = useState<'eth' | 'tokens' | null>(null);
  const mode = router ? (modeChoice ?? 'eth') : 'tokens';

  const picked = ORDERED.filter((t) => picks.includes(t.id) && (mode === 'tokens' || ROUTER_IDS.has(t.id)));
  const mix = useEthMix(mode === 'eth' ? picked : [], marketById);
  const ethProblems = ethMixProblems(mix, ethBal.data?.value, isConnected);
  const ethForge = useEthForge({
    mix,
    router,
    account: address,
    problems: ethProblems,
    onForged: setForgedId,
    onDone: () => ethBal.refetch(),
  });

  const rows = picked.map((t) => {
    const raw = amounts[t.id] ?? '';
    const amount = raw === '' ? 0n : parseTokenAmount(raw, t.decimals);
    const eth = marketById.get(t.id)?.market.eth ?? null;
    // 0 = nothing typed; null = typed but no price to value it with
    const value: number | null = amount && amount > 0n ? (eth !== null ? Number(formatUnits(amount, t.decimals)) * eth : null) : 0;
    return { t, raw, amount, value };
  });
  const ethWei = ethInput === '' ? 0n : (parseTokenAmount(ethInput, 18) ?? -1n);
  const ethValue = ethWei > 0n ? Number(formatUnits(ethWei, 18)) : 0;

  const filled = rows.filter((r) => r.amount && r.amount > 0n);
  const plan = planDeposit(
    filled.map((r) => ({
      token: r.t.address,
      symbol: r.t.id,
      amount: r.amount!,
      balance: balanceOf(r.t) ?? 0n,
      allowance: allowanceOf(r.t),
    })),
    { amount: ethWei > 0n ? ethWei : 0n, balance: ethBal.data?.value ?? 0n },
    MAX_ASSETS,
  );
  const problems = [
    ...rows.filter((r) => r.raw !== '' && r.amount === null).map((r) => `Check the amount for ${r.t.id}.`),
    ...(ethWei === -1n ? ['Check the ETH amount.'] : []),
    ...(isConnected ? plan.problems : []),
  ];

  // live preview: value-weighted (ETH), or even weights before any amount is typed
  const values = [...rows.map((r) => r.value), ethValue];
  const typed = values.some((v) => v === null || v > 0);
  const weights = typed ? valueWeights(values) : [...rows.map(() => 1 / Math.max(1, rows.length)), 0];
  const pct = normalizeTo100(weights.map((w) => w * 100));
  const weth = marketById.get('WETH');
  const holdingOf = (symbol: string, weight: number, m?: LiveToken) => ({
    symbol,
    weight,
    change24h: m?.market.change24h ?? Number.NaN,
    volatility: m?.market.volatility ?? DEFAULT_VOLATILITY,
  });
  const tokenHoldings: Holding[] = [
    ...rows.map((r, i) => holdingOf(r.t.id, weights[i]!, marketById.get(r.t.id))),
    holdingOf('ETH', weights[rows.length] ?? 0, weth),
  ].filter((h) => h.weight > 0);
  // ETH mode previews the slider mix: each stock's share of the ETH, plus ETH kept
  const ethHoldings: Holding[] = [
    ...picked.map((t, i) => holdingOf(t.id, (mix.percents[i] ?? 0) / 100, marketById.get(t.id))),
    holdingOf('ETH', (mix.percents[picked.length] ?? 0) / 100, weth),
  ].filter((h) => h.weight > 0);
  const preview = mode === 'eth' ? (picked.length > 0 ? ethHoldings : []) : tokenHoldings;

  // the preview card's summary: assets, % each, value in ETH, total
  const summary: { items: SummaryItem[]; total: number | null } =
    mode === 'eth'
      ? {
          items: [
            ...mix.rows.filter((r) => r.percent > 0).map((r) => ({ id: r.t.id, pct: r.percent, eth: Number(formatUnits(r.ethIn, 18)) })),
            ...(mix.kept > 0n ? [{ id: 'ETH', pct: mix.percents[mix.rows.length] ?? 0, eth: Number(formatUnits(mix.kept, 18)) }] : []),
          ],
          total: mix.total && mix.total > 0n ? Number(formatUnits(mix.total, 18)) : null,
        }
      : {
          items: [
            // before any amount: every pick at an even share; after: only what has an amount
            ...rows.map((r, i) => ({ id: r.t.id, pct: pct[i] ?? 0, eth: r.value })).filter((_, i) => !typed || rows[i]!.value !== 0),
            ...(ethWei > 0n ? [{ id: 'ETH', pct: pct[rows.length] ?? 0, eth: ethValue }] : []),
          ],
          total: typed ? values.reduce<number>((s, v) => s + (v ?? 0), 0) : null,
        };

  const pickLimit = mode === 'eth' ? ROUTER_TOKENS.length : MAX_ASSETS;
  const toggle = (id: string) =>
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < pickLimit ? [...p, id] : p));

  const amountsReady = (filled.length > 0 || ethWei > 0n) && problems.length === 0;

  const forge = async () => {
    if (!address || !crystal) return;
    setForgedId(null);
    await tx.run(
      depositSteps({
        crystal,
        account: address,
        items: filled.map((r) => ({ token: r.t.address, symbol: r.t.id, amount: r.amount! })),
        needsApproval: plan.approvals.map((a) => ({ token: a.token, symbol: a.symbol, amount: a.amount })),
        ethWei: ethWei > 0n ? ethWei : 0n,
        target: { kind: 'forge' },
        onForged: (id) => setForgedId(id),
      }),
    );
    reads.refetch();
    ethBal.refetch();
  };

  const approvals = plan.approvals.length;
  const reviewItems = [
    ...filled.map((r) => ({ id: r.t.id, amount: r.amount!, dec: r.t.decimals, i: rows.indexOf(r) })),
    ...(ethWei > 0n ? [{ id: 'ETH', amount: ethWei, dec: 18, i: rows.length }] : []),
  ];
  const go = (s: number) => {
    setStep(s);
    // keep the step's top in view after switching
    document.getElementById('forge-steps')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const running = tx.running || ethForge.tx.running;

  // the page's one GuideNote: what matters most right now
  const guide =
    forgedId !== null ? (
      <GuideNote
        index={7}
        action={
          <Link to="/my-crystals" className="btn btn-primary">
            See it in My Crystals
          </Link>
        }
      >
        Done! Crystal #{forgedId.toString()} is in your wallet.
      </GuideNote>
    ) : !isConnected ? (
      <GuideNote index={6} action={<WalletButton variant="hero" />}>
        Look around freely. Connect a wallet when you want to see what you own and forge for real.
      </GuideNote>
    ) : mode === 'tokens' && balancesKnown && !ownsAnyStock ? (
      <GuideNote index={6}>
        You don’t own test stocks yet. You can still forge a crystal with just ETH and add stocks to it later.
      </GuideNote>
    ) : (
      <GuideNote index={6}>Pick what goes in, choose how much, then forge. Nothing happens until you confirm in your wallet.</GuideNote>
    );

  // the action bar's right-hand button for each step
  let next: ReactNode;
  let status: ReactNode = null;
  if (step === 0) {
    status = mode === 'eth' ? 'One swap, one crystal' : 'Use tokens you own';
    next = (
      <button className="btn btn-primary" onClick={() => go(1)}>
        Next: pick →
      </button>
    );
  } else if (step === 1) {
    status = picked.length > 0 ? `${picked.length} picked` : mode === 'eth' ? 'Pick at least one stock' : 'Or go on with ETH only';
    next = (
      <button className="btn btn-primary" disabled={mode === 'eth' && picked.length === 0} onClick={() => go(2)}>
        Next: amounts →
      </button>
    );
  } else if (step === 2) {
    const blocked = mode === 'eth' ? ethProblems.length > 0 : !amountsReady;
    status = blocked ? (mode === 'eth' ? ethProblems[0] : problems[0] ?? 'Enter at least one amount') : 'Looks good';
    next = (
      <button className="btn btn-primary" disabled={blocked} onClick={() => go(3)}>
        Next: review →
      </button>
    );
  } else {
    const ready = mode === 'eth' ? ethForge.ready : problems.length === 0;
    next =
      mode === 'eth' && !router ? (
        <button className="btn btn-primary" disabled>
          Forge from ETH (soon)
        </button>
      ) : !crystal ? (
        <button className="btn btn-primary" disabled>
          Contract not deployed yet
        </button>
      ) : !isConnected ? (
        <WalletButton variant="hero" />
      ) : !onTarget ? (
        <SwitchNetworkButton />
      ) : (
        <button className="btn btn-primary" disabled={!ready || running || forgedId !== null} onClick={mode === 'eth' ? ethForge.forge : forge}>
          {running ? 'Working…' : forgedId !== null ? 'Forged ✓' : mode === 'eth' ? 'Swap & forge' : 'Forge crystal'}
        </button>
      );
    status = forgedId !== null ? `Crystal #${forgedId} is in your wallet` : 'Check it, then forge';
  }

  return (
    <PageScroll>
      <PageHeader
        label="Forge"
        lead="Forge a"
        accent="crystal."
        subtitle="Put test stocks and ETH into one crystal that lives in your wallet. Four short steps."
        guide={guide}
      />
      {/* right after a first forge: invite them to claim a name (hidden until profiles exist) */}
      {forgedId !== null && address && <ClaimBanner address={address} />}

      <div className="grid grid-cols-12 gap-6">
        {/* ------------------------------------------------------------ wizard (7/12) */}
        <div id="forge-steps" className="col-span-12 flex min-w-0 scroll-mt-28 flex-col gap-6 lg:col-span-7">
          <ol className="grid grid-cols-4 gap-3" aria-label="Progress">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={i >= step || running}
                  onClick={() => go(i)}
                  className="w-full text-left disabled:cursor-default"
                  aria-current={i === step ? 'step' : undefined}
                >
                  <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                    <motion.span
                      className="block h-full origin-left rounded-full bg-lime"
                      initial={false}
                      animate={{ scaleX: i <= step ? 1 : 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    />
                  </span>
                  <span className={`section-label mt-3 block text-[11px] ${i === step ? '!text-lime' : i < step ? '!text-white' : ''}`}>
                    0{i + 1}
                    <span className="hidden sm:inline"> · {label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="-mt-2 font-display text-2xl font-bold tracking-[-0.02em] sm:hidden">{STEPS[step]}</p>

          {step === 0 && (
            <div className="grid gap-6 sm:grid-cols-2">
              <ModeCard
                on={mode === 'eth'}
                soon={!router}
                title="Start with ETH"
                text={
                  router
                    ? 'Choose stocks and how much of each. One transaction swaps your ETH and forges the crystal.'
                    : 'One transaction that swaps ETH into stocks and forges the crystal. Turns on once its contract is deployed.'
                }
                onClick={() => setModeChoice('eth')}
              />
              <ModeCard
                on={mode === 'tokens'}
                title="I have test stocks"
                text="Put test stocks you already own (and some ETH, if you like) into a crystal."
                onClick={() => setModeChoice('tokens')}
              />
            </div>
          )}

          {step === 1 && (
            <>
              <p className="text-[15px] leading-relaxed text-mist">
                {mode === 'eth'
                  ? `Tap the stocks you want: up to ${ROUTER_TOKENS.length}. They are vibe/vibe test tokens with no real value.`
                  : `Tap the tokens you want inside: up to ${MAX_ASSETS} (adding ETH counts as one). They are vibe/vibe test tokens with no real value.`}
              </p>
              {GROUPS.map((g) => {
                const tokens = g.ids
                  .map((id) => BASKET_TOKENS.find((t) => t.id === id))
                  .filter((t): t is TestnetToken => !!t && (mode === 'tokens' || ROUTER_IDS.has(t.id)));
                if (tokens.length === 0) return null;
                return (
                  <section key={g.label} className="flex flex-col gap-3">
                    <h3 className="section-label text-[11px]">{g.label}</h3>
                    <div className="grid gap-6 sm:grid-cols-2">
                      {tokens.map((t) => (
                        <TokenCard
                          key={t.id}
                          token={t}
                          market={marketById.get(t.id)?.market}
                          loading={live.status === 'loading'}
                          on={picks.includes(t.id)}
                          balance={isConnected && mode === 'tokens' ? balanceOf(t) : undefined}
                          onToggle={() => toggle(t.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </>
          )}

          {step === 2 && mode === 'eth' && (
            <>
              <p className="text-[15px] leading-relaxed text-mist">How much ETH, and how should it be split? Quotes come live from the Uniswap pools.</p>
              <EthAmounts mix={mix} balance={ethBal.data?.value} connected={isConnected} />
              {ethProblems.length > 0 && mix.ethInput !== '' && (
                <ul className="space-y-0.5 text-sm text-down">
                  {ethProblems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {step === 2 && mode === 'tokens' && (
            <>
              <p className="text-[15px] leading-relaxed text-mist">How much of each should go in? Amounts are in token units. ETH is optional.</p>
              <div className="card divide-y divide-white/[0.06]">
                {[...rows.map((r, i) => ({ r, i })), { r: null, i: rows.length }].map(({ r, i }) => {
                  const id = r ? r.t.id : 'ETH';
                  const bal = r ? balanceOf(r.t) : (ethBal.data?.value ?? null);
                  const dec = r ? r.t.decimals : 18;
                  const raw = r ? r.raw : ethInput;
                  const set = (v: string) => (r ? setAmounts((a) => ({ ...a, [id]: v })) : setEthInput(v));
                  const max = r ? bal : bal !== null ? (bal > GAS_RESERVE_WEI ? bal - GAS_RESERVE_WEI : 0n) : null;
                  const share = typed ? (pct[i] ?? 0) : 0;
                  return (
                    <div key={id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 p-5 sm:grid-cols-[120px_1fr_110px]">
                      <div className="min-w-0">
                        <p className="font-display text-lg font-bold">{id}</p>
                        {isConnected && <p className="truncate font-mono text-[11px] text-mist">wallet: {bal === null ? '…' : fmt(bal, dec)}</p>}
                      </div>
                      <p className="text-right text-sm sm:order-last">
                        {share > 0 ? (
                          <>
                            <span className="font-mono font-bold text-lime">{share}%</span>
                            <span className="block text-[11px] text-mist">of crystal</span>
                          </>
                        ) : (
                          <span className="text-mist">—</span>
                        )}
                      </p>
                      <div className="col-span-2 flex gap-2 sm:col-span-1">
                        <input
                          inputMode="decimal"
                          placeholder={r ? '0.0' : '0.0 (optional)'}
                          value={raw}
                          onChange={(e) => {
                            tx.reset();
                            set(e.target.value);
                          }}
                          aria-label={`${id} amount`}
                          className="w-full min-w-0 rounded-xl border border-white/10 bg-ink px-3 py-2.5 font-mono text-sm outline-none focus:border-lime/60"
                        />
                        <button
                          type="button"
                          className="chip"
                          disabled={!max}
                          onClick={() => max && set(formatUnits(max, dec))}
                          title={r ? undefined : 'Leaves ~0.002 ETH for fees'}
                        >
                          Max
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {rows.some((r) => r.value === null) && <p className="text-xs text-mist">Tokens without a price get an even share in the preview.</p>}
              {problems.length > 0 && (filled.length > 0 || ethInput !== '') && (
                <ul className="space-y-0.5 text-sm text-down">
                  {problems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}
              {!isConnected && <p className="text-xs text-mist">Connect a wallet to see your balances and to forge.</p>}
            </>
          )}

          {step === 3 && mode === 'eth' && (
            <>
              <EthReview mix={mix} problems={ethProblems} />
              <StepList steps={ethForge.tx.steps} />
            </>
          )}

          {step === 3 && mode === 'tokens' && (
            <>
              <div className="card space-y-6 p-6">
                <div>
                  <p className="section-label text-[11px]">What goes in</p>
                  <ul className="mt-3 space-y-2">
                    {reviewItems.map((x) => (
                      <li key={x.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span>
                          <span className="font-mono">{fmt(x.amount, x.dec)}</span> <span className="font-bold">{x.id}</span>
                        </span>
                        <span className="font-mono text-mist">{pct[x.i] ?? 0}% of the crystal</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="section-label text-[11px]">What will happen</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/90">
                    {approvals > 0
                      ? `${approvals} approval${approvals > 1 ? 's' : ''} (letting the crystal take exactly these tokens), then 1 forge transaction.`
                      : '1 forge transaction.'}{' '}
                    Your wallet asks you to confirm each one.
                  </p>
                </div>
                <p className="rounded-2xl bg-lime/5 px-4 py-3 text-sm font-medium text-lime">Only you can withdraw. No admin can touch it.</p>
                {problems.length > 0 && (
                  <ul className="space-y-0.5 text-sm text-down">
                    {problems.map((p) => (
                      <li key={p}>· {p}</li>
                    ))}
                  </ul>
                )}
              </div>
              <StepList steps={tx.steps} />
            </>
          )}

          {forgedId !== null && step === 3 && (
            <p className="text-sm text-white">
              Crystal #{forgedId.toString()} is in your wallet.{' '}
              <Link to="/my-crystals" className="text-lime underline">
                See it in My Crystals →
              </Link>
            </p>
          )}

          {!desktop && <PreviewFold holdings={preview} items={summary.items} total={summary.total} />}
          <ActionBar back={step > 0 && !running ? () => go(step - 1) : undefined} status={status}>
            {next}
          </ActionBar>
        </div>

        {/* ------------------------------------------------------------ preview (5/12) */}
        {desktop && (
          <aside className="col-span-5 min-w-0">
            <PreviewCard holdings={preview} items={summary.items} total={summary.total} />
          </aside>
        )}
      </div>
    </PageScroll>
  );
}
