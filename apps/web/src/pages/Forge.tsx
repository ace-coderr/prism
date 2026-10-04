import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { useBalance, useReadContracts } from 'wagmi';
import {
  BASKET_TOKENS,
  GAS_RESERVE_WEI,
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
import { Change, EthPrice, LiveBadge, Panel } from '../components/ui';
import { ViberGuide } from '../components/Viber';
import { DEFAULT_VOLATILITY } from '../data/crystalHoldings';
import { useTestnetTokens, type LiveToken } from '../data/chain';
import { TARGET_CHAIN } from '../wallet/config';
import { depositSteps } from '../wallet/deposit';
import { StepList, useTxSteps } from '../wallet/steps';
import { SwitchNetworkButton, WalletButton, useWallet } from '../wallet/WalletButton';

const MAX_ASSETS = 8;

/** Token groups on the Pick step, in this order. */
const GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Stocks', ids: ['AAPL', 'NVDA', 'SPCX'] },
  { label: 'Pre-IPO', ids: ['ANTHROPIC', 'OPENAI'] },
  { label: 'Crypto', ids: ['WETH'] },
];
const STEPS = ['Pick', 'Amounts', 'Review'] as const;

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
            <Change value={m.change24h} /> <span className="text-mist">today</span>
          </span>
        )}
      </span>
      {balance !== undefined && (
        <span className="mt-3 block font-mono text-[11px] text-mist">You own {balance === null ? '…' : fmt(balance, t.decimals)}</span>
      )}
    </button>
  );
}

export default function Forge() {
  const deployment = getDeployment(TARGET_CHAIN.id);
  const crystal = deployment?.prismCrystal;
  const live = useTestnetTokens();
  const { address, isConnected, onTarget } = useWallet();
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

  const picked = ORDERED.filter((t) => picks.includes(t.id));
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
  const holdings: Holding[] = [
    ...rows.map((r, i) => ({
      symbol: r.t.id,
      weight: weights[i]!,
      change24h: marketById.get(r.t.id)?.market.change24h ?? Number.NaN,
      volatility: marketById.get(r.t.id)?.market.volatility ?? DEFAULT_VOLATILITY,
    })),
    {
      symbol: 'ETH',
      weight: weights[rows.length] ?? 0,
      change24h: weth?.market.change24h ?? Number.NaN,
      volatility: weth?.market.volatility ?? DEFAULT_VOLATILITY,
    },
  ].filter((h) => h.weight > 0);

  const toggle = (id: string) =>
    setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_ASSETS ? [...p, id] : p));

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

  return (
    <PageScroll>
      <PageHeader
        label="Forge"
        lead="Forge a"
        accent="crystal."
        subtitle="Put test stocks and ETH into one crystal that lives in your wallet. Three steps, about a minute."
      >
        {live.status === 'live' && <LiveBadge />}
      </PageHeader>

      <div className="flex flex-col gap-10">
        {/* progress */}
        <ol className="grid grid-cols-3 gap-3 md:gap-5" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                disabled={i >= step}
                onClick={() => setStep(i)}
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
                  0{i + 1} / {label}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="grid gap-10 lg:grid-cols-[1fr_440px] lg:gap-12">
        {/* ------------------------------------------------------------ wizard */}
        <div className="order-2 flex min-w-0 flex-col gap-8 lg:order-1">
          {step === 0 && (
            <>
              <p className="body-copy">
                Tap the tokens you want inside: up to {MAX_ASSETS} (adding ETH counts as one). They are vibe/vibe test tokens
                with no real value.
              </p>
              {!isConnected && (
                <div className="card flex flex-col items-start gap-5 p-6 xl:flex-row xl:items-center xl:justify-between">
                  <ViberGuide index={6} size={72}>
                    Look around freely. Connect a wallet when you want to see what you own and forge for real.
                  </ViberGuide>
                  <WalletButton variant="hero" />
                </div>
              )}
              {balancesKnown && !ownsAnyStock && (
                <div className="card flex flex-col items-start gap-5 p-6 xl:flex-row xl:items-center xl:justify-between">
                  <ViberGuide index={6} size={72}>
                    You don’t own test stocks yet. You can forge with ETH now.
                  </ViberGuide>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-primary" onClick={() => setStep(1)}>
                      Use ETH only
                    </button>
                    <button className="btn btn-secondary" disabled title="Buying test stocks with ETH inside PRISM is coming soon">
                      Forge from ETH (soon)
                    </button>
                  </div>
                </div>
              )}
              {GROUPS.map((g) => {
                const tokens = g.ids.map((id) => BASKET_TOKENS.find((t) => t.id === id)).filter((t): t is TestnetToken => !!t);
                if (tokens.length === 0) return null;
                return (
                  <section key={g.label} className="flex flex-col gap-4">
                    <h3 className="section-label text-[11px]">{g.label}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      {tokens.map((t) => (
                        <TokenCard
                          key={t.id}
                          token={t}
                          market={marketById.get(t.id)?.market}
                          loading={live.status === 'loading'}
                          on={picks.includes(t.id)}
                          balance={isConnected ? balanceOf(t) : undefined}
                          onToggle={() => toggle(t.id)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.08] pt-8">
                <p className="text-sm text-mist">{picks.length === 0 ? 'Nothing picked yet. You can also go on with ETH only.' : `${picks.length} picked.`}</p>
                <button className="btn btn-primary btn-lg" onClick={() => setStep(1)}>
                  Next: amounts →
                </button>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm text-mist">How much of each should go in? Amounts are in token units. ETH is optional.</p>
              <Panel className="divide-y divide-white/10">
                {[...rows.map((r, i) => ({ r, i })), { r: null, i: rows.length }].map(({ r, i }) => {
                  const id = r ? r.t.id : 'ETH';
                  const bal = r ? balanceOf(r.t) : (ethBal.data?.value ?? null);
                  const dec = r ? r.t.decimals : 18;
                  const raw = r ? r.raw : ethInput;
                  const set = (v: string) => (r ? setAmounts((a) => ({ ...a, [id]: v })) : setEthInput(v));
                  const max = r ? bal : bal !== null ? (bal > GAS_RESERVE_WEI ? bal - GAS_RESERVE_WEI : 0n) : null;
                  const share = typed ? (pct[i] ?? 0) : 0;
                  return (
                    <div key={id} className="grid gap-2 p-4 sm:grid-cols-[110px_1fr_170px] sm:items-center">
                      <div>
                        <p className="font-display text-lg font-bold">{id}</p>
                        {isConnected && <p className="font-mono text-[11px] text-mist">wallet: {bal === null ? '…' : fmt(bal, dec)}</p>}
                      </div>
                      <div className="flex gap-2">
                        <input
                          inputMode="decimal"
                          placeholder={r ? '0.0' : '0.0 (optional)'}
                          value={raw}
                          onChange={(e) => {
                            tx.reset();
                            set(e.target.value);
                          }}
                          aria-label={`${id} amount`}
                          className="w-full rounded-xl border border-white/10 bg-ink px-3 py-2.5 font-mono text-sm outline-none focus:border-lime/60"
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
                      <p className="text-sm sm:text-right">
                        {share > 0 ? (
                          <>
                            <span className="font-bold text-white">{id}</span> <span className="text-mist">is</span>{' '}
                            <span className="font-mono font-bold text-lime">{share}%</span> <span className="text-mist">of this crystal</span>
                          </>
                        ) : (
                          <span className="text-mist">—</span>
                        )}
                      </p>
                    </div>
                  );
                })}
              </Panel>
              {rows.some((r) => r.value === null) && (
                <p className="text-xs text-mist">Tokens without a price get an even share in the preview.</p>
              )}
              {problems.length > 0 && (filled.length > 0 || ethInput !== '') && (
                <ul className="space-y-0.5 text-sm text-down">
                  {problems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}
              {!isConnected && <p className="text-xs text-mist">Connect a wallet to see your balances and to forge.</p>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="btn btn-secondary" onClick={() => setStep(0)}>
                  ← Back
                </button>
                <button className="btn btn-primary" disabled={!amountsReady} onClick={() => setStep(2)}>
                  Next: review →
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Panel className="space-y-5 p-5">
                <div>
                  <p className="label text-mist">What goes in</p>
                  <ul className="mt-2 space-y-1.5">
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
                  <p className="label text-mist">What will happen</p>
                  <p className="mt-2 text-sm text-white/90">
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
              </Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="btn btn-secondary" disabled={tx.running} onClick={() => setStep(1)}>
                  ← Back
                </button>
                {!crystal ? (
                  <button className="btn btn-primary" disabled>
                    Contract not deployed yet
                  </button>
                ) : !isConnected ? (
                  <WalletButton variant="hero" />
                ) : !onTarget ? (
                  <SwitchNetworkButton />
                ) : (
                  <button className="btn btn-primary" disabled={tx.running || problems.length > 0 || forgedId !== null} onClick={forge}>
                    {tx.running ? 'Working…' : forgedId !== null ? 'Forged ✓' : 'Forge crystal'}
                  </button>
                )}
              </div>
              <StepList steps={tx.steps} />
              {forgedId !== null && (
                <ViberGuide index={7}>
                  Done! Crystal #{forgedId.toString()} is in your wallet.{' '}
                  <Link to="/my-crystals" className="text-lime underline">
                    See it in My Crystals →
                  </Link>
                </ViberGuide>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------------------ preview */}
        {/* on phones the preview sits above the steps, so it only appears once there is something to show */}
        <div className={`order-1 lg:order-2 ${holdings.length === 0 ? 'hidden lg:block' : ''}`}>
          <div className="relative h-[300px] overflow-hidden rounded-[32px] border border-white/[0.08] lg:sticky lg:top-28 lg:h-[560px]">
            <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
              {holdings.length > 0 && <FittedCrystal holdings={holdings} size={1.6} spin={0.2} top={0.12} bottom={0.86} />}
            </Stage>
            {holdings.length === 0 && (
              <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-mist">Pick a token to see your crystal take shape.</p>
            )}
            <p className="section-label pointer-events-none absolute left-6 top-6 text-[11px]">Live preview</p>
            <p className="pointer-events-none absolute bottom-5 left-6 right-6 font-mono text-[10px] text-mist/80">
              Size = how much · colour = today’s move · spikes = how jumpy the price is
            </p>
          </div>
        </div>
      </div>
      </div>
    </PageScroll>
  );
}
