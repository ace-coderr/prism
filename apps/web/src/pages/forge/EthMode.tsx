import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { formatUnits, parseEventLogs, type Address } from 'viem';
import { simulateContract } from 'wagmi/actions';
import {
  GAS_RESERVE_WEI,
  IMPACT_WARN,
  defaultSlippageBps,
  evenWeights,
  minOut,
  minsAtSend,
  parseTokenAmount,
  priceImpact,
  priceMovedMessage,
  prismForgeRouterAbi,
  quoteEthToToken,
  rebalance,
  splitEth,
  suggestSmallerEth,
  thinPoolNote,
  type TestnetToken,
} from '@prism/core';
import { Panel } from '../../components/ui';
import { testnetClient, type LiveToken } from '../../data/chain';
import { TARGET_CHAIN, wagmiConfig } from '../../wallet/config';
import { useTxSteps } from '../../wallet/steps';

/*
 * "Start with ETH": one ETH amount, a slider per picked stock (plus "keep as ETH"),
 * live V4 quotes and price impact, then ONE transaction through PrismForgeRouter that
 * swaps the ETH and forges the crystal.
 */

const SLIPPAGES = [50, 100, 200, 300]; // basis points
const fmt = (v: bigint, d: number, max = 4) => {
  const n = Number(formatUnits(v, d));
  return n === 0 ? '0' : n < 0.0001 ? '<0.0001' : n.toLocaleString('en-US', { maximumFractionDigits: max });
};
const pctText = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
/** One cache entry per (token, ETH in): the list on screen and the check before sending share it. */
const quoteKey = (t: TestnetToken, ethIn: bigint) => ['v4-quote', t.id, ethIn.toString()];

/** Debounce a value (quotes follow typing after a short pause). */
function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface EthMix {
  ethInput: string;
  setEthInput: (v: string) => void;
  total: bigint | null;
  /** integer percents: one per picked token, then the share kept as ETH (last) */
  percents: number[];
  setPercent: (i: number, value: number) => void;
  slippageBps: number;
  setSlippageBps: (bps: number) => void;
  /** why the slippage starts at 3% (a thin pool is picked), else null */
  thinNote: string | null;
  rows: Array<{ t: TestnetToken; percent: number; ethIn: bigint; quote: bigint | null; loading: boolean; impact: number | null; min: bigint | null }>;
  kept: bigint;
  worstImpact: number;
  suggestion: bigint | null;
  quotesReady: boolean;
}

export function useEthMix(picked: TestnetToken[], markets: Map<string, LiveToken>): EthMix {
  const [ethInput, setEthInput] = useState('0.05');
  const [percents, setPercents] = useState<number[]>([100]);
  const [slippageBps, setSlippageBps] = useState(() => defaultSlippageBps(picked));
  const key = picked.map((t) => t.id).join(',');
  // a new pick resets the mix: even across the stocks, nothing kept as ETH, and the
  // slippage back to its default for these stocks (3% with a thin pool, else 1%)
  useEffect(() => {
    setPercents(picked.length === 0 ? [100] : [...evenWeights(picked.length), 0]);
    setSlippageBps(defaultSlippageBps(picked));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = ethInput === '' ? 0n : parseTokenAmount(ethInput, 18);
  const parts = useMemo(() => splitEth(total && total > 0n ? total : 0n, percents), [total, percents]);
  const debouncedParts = useDebounced(parts.map(String).join(','));
  const quoted = useMemo(() => debouncedParts.split(',').map((x) => BigInt(x || '0')), [debouncedParts]);

  const quotes = useQueries({
    queries: picked.map((t, i) => {
      const ethIn = quoted[i] ?? 0n;
      return {
        queryKey: quoteKey(t, ethIn),
        enabled: ethIn > 0n,
        // the pools trade every few seconds; keep what's on screen close to what a swap gets
        staleTime: 5_000,
        refetchInterval: 10_000,
        queryFn: () => quoteEthToToken(testnetClient, t, ethIn),
      };
    }),
  });

  const rows = picked.map((t, i) => {
    const ethIn = parts[i] ?? 0n;
    const fresh = (quoted[i] ?? 0n) === ethIn;
    const quote = fresh ? (quotes[i]?.data ?? null) : null;
    const impact = quote !== null ? priceImpact(ethIn, quote, markets.get(t.id)?.market.eth ?? null, t.decimals) : null;
    return {
      t,
      percent: percents[i] ?? 0,
      ethIn,
      quote,
      loading: ethIn > 0n && quote === null,
      impact,
      min: quote !== null ? minOut(quote, slippageBps) : null,
    };
  });
  const worstImpact = rows.reduce((m, r) => Math.max(m, r.impact ?? 0), 0);
  return {
    ethInput,
    setEthInput,
    total,
    percents,
    setPercent: (i, value) => setPercents((p) => rebalance(p, i, value)),
    slippageBps,
    setSlippageBps,
    thinNote: thinPoolNote(picked),
    rows,
    kept: parts[picked.length] ?? 0n,
    worstImpact,
    suggestion: total ? suggestSmallerEth(total, worstImpact) : null,
    quotesReady: rows.every((r) => r.ethIn === 0n || r.quote !== null),
  };
}

/** Problems that block the Review step, in plain words. */
export function ethMixProblems(mix: EthMix, balance: bigint | undefined, connected: boolean): string[] {
  const out: string[] = [];
  if (mix.total === null) out.push('Check the ETH amount.');
  else if (mix.total <= 0n) out.push('Enter how much ETH to put in.');
  if (mix.rows.length === 0) out.push('Pick at least one stock.');
  if (mix.rows.some((r) => r.ethIn === 0n)) out.push('Every picked stock needs a share above 0%, or unpick it.');
  if (connected && balance !== undefined && mix.total && mix.total + GAS_RESERVE_WEI > balance) {
    out.push(`You have ${fmt(balance, 18)} ETH. Keep about ${fmt(GAS_RESERVE_WEI, 18)} ETH for the fee.`);
  }
  return out;
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      aria-label={`${label} share`}
      onChange={(e) => onChange(Number(e.target.value))}
      className="prism-range"
      style={{ ['--fill' as string]: `${value}%` }}
    />
  );
}

export function EthAmounts({ mix, balance, connected }: { mix: EthMix; balance?: bigint; connected: boolean }) {
  const max = balance !== undefined && balance > GAS_RESERVE_WEI ? balance - GAS_RESERVE_WEI : null;
  return (
    <div className="flex flex-col gap-6">
      <Panel className="rounded-3xl p-6">
        <label className="block">
          <span className="section-label text-[11px]">How much ETH</span>
          <span className="mt-3 flex gap-2">
            <input
              inputMode="decimal"
              value={mix.ethInput}
              onChange={(e) => mix.setEthInput(e.target.value)}
              aria-label="ETH amount"
              className="w-full rounded-2xl border border-white/10 bg-ink px-4 py-3 font-mono text-lg outline-none focus:border-lime/60"
            />
            <button type="button" className="chip" disabled={!max} onClick={() => max && mix.setEthInput(formatUnits(max, 18))} title="Leaves ~0.002 ETH for fees">
              Max
            </button>
          </span>
          {connected && balance !== undefined && <span className="mt-2 block font-mono text-[11px] text-mist">wallet: {fmt(balance, 18)} ETH</span>}
        </label>
      </Panel>

      <Panel className="divide-y divide-white/[0.06] rounded-3xl">
        <div className="flex items-baseline justify-between px-6 pb-3 pt-5">
          <span className="section-label text-[11px]">The mix (adds up to 100%)</span>
          <span className="section-label text-[11px]">You get about</span>
        </div>
        {mix.rows.map((r, i) => (
          <div key={r.t.id} className="grid gap-3 px-6 py-5 sm:grid-cols-[120px_1fr_180px] sm:items-center">
            <div>
              <p className="font-display text-lg font-bold">{r.t.id}</p>
              <p className="font-mono text-[11px] text-mist">
                {r.percent}% · {fmt(r.ethIn, 18, 5)} ETH
              </p>
            </div>
            <Slider label={r.t.id} value={r.percent} onChange={(v) => mix.setPercent(i, v)} />
            <div className="text-sm sm:text-right">
              {r.ethIn === 0n ? (
                <span className="text-mist">—</span>
              ) : r.quote === null ? (
                <span className="font-mono text-xs text-mist">quoting…</span>
              ) : (
                <>
                  <span className="font-mono font-bold text-white">{fmt(r.quote, r.t.decimals)}</span> <span className="text-mist">{r.t.id}</span>
                  {r.impact !== null && (
                    <span className={`block font-mono text-[11px] ${r.impact > IMPACT_WARN ? 'text-amber-300' : 'text-mist'}`}>
                      price impact {pctText(r.impact)}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div className="grid gap-3 px-6 py-5 sm:grid-cols-[120px_1fr_180px] sm:items-center">
          <div>
            <p className="font-display text-lg font-bold">ETH</p>
            <p className="font-mono text-[11px] text-mist">kept as ETH</p>
          </div>
          <Slider label="ETH kept" value={mix.percents[mix.rows.length] ?? 0} onChange={(v) => mix.setPercent(mix.rows.length, v)} />
          <p className="text-sm sm:text-right">
            <span className="font-mono font-bold text-white">{fmt(mix.kept, 18, 5)}</span> <span className="text-mist">ETH</span>
          </p>
        </div>
      </Panel>

      {mix.worstImpact > IMPACT_WARN && (
        <div className="rounded-2xl border border-amber-300/40 bg-amber-300/[0.06] p-5 text-sm leading-relaxed text-amber-100">
          <b>Heads up: {mix.rows.filter((r) => (r.impact ?? 0) > IMPACT_WARN).map((r) => r.t.id).join(' and ')}</b>{' '}
          {mix.rows.filter((r) => (r.impact ?? 0) > IMPACT_WARN).length > 1 ? 'have' : 'has'} a thin pool, so this much ETH moves the price
          about {pctText(mix.worstImpact)} against you.
          {mix.suggestion !== null && <> Try about {fmt(mix.suggestion, 18, 4)} ETH in total, or give it a smaller share.</>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="section-label text-[11px]">Slippage</span>
        {SLIPPAGES.map((bps) => (
          <button key={bps} type="button" className={`chip ${mix.slippageBps === bps ? 'chip-on' : ''}`} onClick={() => mix.setSlippageBps(bps)}>
            {bps / 100}%
          </button>
        ))}
        <span className="text-xs text-mist">If prices move more than this before your transaction lands, nothing happens and your ETH stays put.</span>
      </div>
      {mix.thinNote && <p className="-mt-3 text-xs leading-relaxed text-amber-200/90">{mix.thinNote}</p>}
    </div>
  );
}

/**
 * The one forgeFromETH transaction: swap the ETH and forge, through PrismForgeRouter.
 * The Review step shows `EthReview`; the wizard's action bar holds the button.
 */
export function useEthForge({
  mix,
  router,
  account,
  problems,
  onForged,
  onDone,
}: {
  mix: EthMix;
  router: Address | undefined;
  account: Address | undefined;
  problems: string[];
  onForged: (id: bigint) => void;
  onDone: () => void;
}) {
  const tx = useTxSteps();
  const queryClient = useQueryClient();
  const ready = !!router && !!account && mix.quotesReady && problems.length === 0 && mix.total !== null && mix.total > 0n;
  const forge = async () => {
    if (!router || !account || !mix.total) return;
    const rows = mix.rows;
    const swaps = rows.map((r) => ({ token: r.t.address, ethIn: r.ethIn }));
    const names = rows.map((r) => r.t.id);
    const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const ok = await tx.run([
      {
        label: 'Swapping your ETH and forging your crystal',
        errorContext: { slippageBps: mix.slippageBps },
        tx: {
          description: `Swap ${fmt(mix.total, 18, 5)} ETH into ${list}${mix.kept > 0n ? ` (keeping ${fmt(mix.kept, 18, 5)} as ETH)` : ''} and forge your crystal. If any price moves more than ${mix.slippageBps / 100}%, nothing happens.`,
          action: 'Swap & forge',
          contract: 'PRISM Forge Router',
        },
        send: async (write) => {
          // Quote again right now (this also updates the amounts on screen). A quote can be
          // seconds old, and a thin pool can move more than the slippage in that time.
          const fresh = await Promise.all(
            rows.map((r) =>
              queryClient.fetchQuery({ queryKey: quoteKey(r.t, r.ethIn), queryFn: () => quoteEthToToken(testnetClient, r.t, r.ethIn), staleTime: 0 }),
            ),
          );
          const check = minsAtSend(rows.map((r) => r.min!), fresh, mix.slippageBps);
          if (!check.ok) throw new Error(priceMovedMessage(check.moved.map((m) => ({ ...m, token: rows[m.index]!.t })), mix.slippageBps));
          const { request } = await simulateContract(wagmiConfig, {
            address: router,
            abi: prismForgeRouterAbi,
            functionName: 'forgeFromETH',
            args: [swaps, check.mins, mix.kept],
            value: mix.total!,
            chainId: TARGET_CHAIN.id,
            account,
          });
          return write(request);
        },
        after: (receipt) => {
          const [ev] = parseEventLogs({ abi: prismForgeRouterAbi, eventName: 'ForgedFromETH', logs: receipt.logs });
          if (ev) onForged(ev.args.id);
        },
      },
    ]);
    // after a failure, show what the same ETH buys now
    if (!ok) void queryClient.invalidateQueries({ queryKey: ['v4-quote'] });
    onDone();
  };
  return { tx, ready, forge };
}

/** Review step for "Start with ETH": what goes in and what will happen. */
export function EthReview({ mix, problems }: { mix: EthMix; problems: string[] }) {
  const names = mix.rows.map((r) => r.t.id);
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return (
    <Panel className="space-y-6 rounded-3xl p-6">
      <div>
        <p className="section-label text-[11px]">What goes in</p>
        <ul className="mt-3 space-y-2">
          {mix.rows.map((r) => (
            <li key={r.t.id} className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
              <span>
                <span className="font-mono">{fmt(r.ethIn, 18, 5)} ETH</span> <span className="text-mist">→ about</span>{' '}
                <span className="font-mono">{r.quote !== null ? fmt(r.quote, r.t.decimals) : '…'}</span> <span className="font-bold">{r.t.id}</span>
              </span>
              <span className="font-mono text-xs text-mist">at least {r.min !== null ? fmt(r.min, r.t.decimals) : '…'}</span>
            </li>
          ))}
          {mix.kept > 0n && (
            <li className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                <span className="font-mono">{fmt(mix.kept, 18, 5)}</span> <span className="font-bold">ETH</span> <span className="text-mist">kept as ETH</span>
              </span>
            </li>
          )}
        </ul>
      </div>
      <div>
        <p className="section-label text-[11px]">What will happen</p>
        <p className="mt-2 text-sm leading-relaxed text-white/90">
          1 transaction: swap your ETH into {list} and forge your crystal. Your wallet asks you to confirm it once.
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
  );
}
