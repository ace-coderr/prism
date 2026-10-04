import { useEffect, useMemo, useState } from 'react';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { useBalance, useReadContracts } from 'wagmi';
import { GAS_RESERVE_WEI, parseTokenAmount, planDeposit, type TestnetToken } from '@prism/core';
import { TARGET_CHAIN } from './config';
import { depositSteps } from './deposit';
import { StepList, useTxSteps } from './steps';
import { SwitchNetworkButton, WalletButton, useWallet } from './WalletButton';

const fmt = (v: bigint, d: number) => {
  const n = Number(formatUnits(v, d));
  return n === 0 ? '0' : n < 0.0001 ? '<0.0001' : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
};

/**
 * Amount inputs (token units) with wallet balance + Max, an optional ETH amount,
 * pre-flight checks, then approve → forge / addTo with visible steps.
 */
export function DepositForm(props: {
  crystal: Address;
  tokens: TestnetToken[];
  target: { kind: 'forge' } | { kind: 'add'; id: bigint };
  existingAssets?: number;
  /** ETH per token for the crystal preview (value-weighted); null = unpriced */
  ethPrice?: (t: TestnetToken) => number | null;
  /** reports value-in-ETH per token (same order as `tokens`) + ETH amount, for previews */
  onValues?: (values: Array<number | null>, eth: number) => void;
  onDone?: () => void;
}) {
  const { crystal, tokens, target } = props;
  const { address, isConnected, onTarget } = useWallet();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [ethInput, setEthInput] = useState('');
  const [forgedId, setForgedId] = useState<bigint | null>(null);
  const { steps, running, run, reset } = useTxSteps();

  const reads = useReadContracts({
    contracts: tokens.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [address!], chainId: TARGET_CHAIN.id },
      { address: t.address, abi: erc20Abi, functionName: 'allowance', args: [address!, crystal], chainId: TARGET_CHAIN.id },
    ]),
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const ethBal = useBalance({ address, chainId: TARGET_CHAIN.id, query: { enabled: !!address } });

  const rows = tokens.map((t, i) => {
    const balance = (reads.data?.[i * 2]?.result as bigint | undefined) ?? 0n;
    const allowance = (reads.data?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
    const raw = amounts[t.id] ?? '';
    const amount = raw === '' ? 0n : parseTokenAmount(raw, t.decimals);
    return { t, balance, allowance, raw, amount };
  });
  const ethWei = ethInput === '' ? 0n : (parseTokenAmount(ethInput, 18) ?? -1n);

  // live preview values (in ETH)
  const { ethPrice, onValues } = props;
  const valuesKey = rows.map((r) => `${r.t.id}:${r.amount}`).join('|') + `|${ethWei}`;
  useEffect(() => {
    onValues?.(
      rows.map((r) => {
        const p = ethPrice?.(r.t) ?? null;
        return r.amount && r.amount > 0n && p !== null ? Number(formatUnits(r.amount, r.t.decimals)) * p : null;
      }),
      ethWei > 0n ? Number(formatUnits(ethWei, 18)) : 0,
    );
  }, [valuesKey]);

  const invalid = rows.filter((r) => r.raw !== '' && r.amount === null).map((r) => r.t.symbol);
  const filled = rows.filter((r) => r.amount && r.amount > 0n);
  const plan = useMemo(
    () =>
      planDeposit(
        filled.map((r) => ({ token: r.t.address, symbol: r.t.id, amount: r.amount!, balance: r.balance, allowance: r.allowance })),
        { amount: ethWei > 0n ? ethWei : 0n, balance: ethBal.data?.value ?? 0n },
        8,
        props.existingAssets ?? 0,
      ),
    [valuesKey, reads.data, ethBal.data, props.existingAssets],
  );
  const problems = [
    ...invalid.map((s) => `Invalid amount for ${s}.`),
    ...(ethWei === -1n ? ['Invalid ETH amount.'] : []),
    ...plan.problems,
  ];

  const go = async () => {
    if (!address || problems.length) return;
    setForgedId(null);
    const items = filled.map((r) => ({ token: r.t.address, symbol: r.t.id, amount: r.amount! }));
    const needsApproval = plan.approvals.map((a) => ({ token: a.token, symbol: a.symbol, amount: a.amount }));
    const ok = await run(
      depositSteps({
        crystal,
        account: address,
        items,
        needsApproval,
        ethWei: ethWei > 0n ? ethWei : 0n,
        target,
        onForged: (id) => setForgedId(id),
      }),
    );
    if (ok) {
      reads.refetch();
      ethBal.refetch();
      props.onDone?.();
    }
  };

  if (!isConnected) return <WalletButton />;
  if (!onTarget) return <SwitchNetworkButton />;

  const maxEth = ethBal.data ? (ethBal.data.value > GAS_RESERVE_WEI ? ethBal.data.value - GAS_RESERVE_WEI : 0n) : 0n;
  const verb = target.kind === 'forge' ? 'Forge crystal' : 'Add to crystal';

  return (
    <div className="space-y-3">
      {rows.map(({ t, balance, raw }) => (
        <label key={t.id} className="block">
          <span className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-white">{t.id}</span>
            <span className="font-mono text-mist">wallet: {reads.isLoading ? '…' : fmt(balance, t.decimals)}</span>
          </span>
          <span className="flex gap-2">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={raw}
              disabled={running}
              onChange={(e) => {
                reset();
                setAmounts((a) => ({ ...a, [t.id]: e.target.value }));
              }}
              className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm outline-none focus:border-lime/60"
            />
            <button
              type="button"
              className="chip"
              disabled={running || balance === 0n}
              onClick={() => setAmounts((a) => ({ ...a, [t.id]: formatUnits(balance, t.decimals) }))}
            >
              Max
            </button>
          </span>
        </label>
      ))}

      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-xs">
          <span className="font-medium text-white">ETH (optional)</span>
          <span className="font-mono text-mist">wallet: {ethBal.data ? fmt(ethBal.data.value, 18) : '…'}</span>
        </span>
        <span className="flex gap-2">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={ethInput}
            disabled={running}
            onChange={(e) => {
              reset();
              setEthInput(e.target.value);
            }}
            className="w-full rounded border border-line bg-ink px-3 py-2 font-mono text-sm outline-none focus:border-lime/60"
          />
          <button type="button" className="chip" disabled={running || maxEth === 0n} onClick={() => setEthInput(formatUnits(maxEth, 18))} title="Keeps ~0.002 ETH for gas">
            Max
          </button>
        </span>
      </label>

      {problems.length > 0 && (filled.length > 0 || ethInput !== '') && (
        <ul className="space-y-0.5 text-xs text-down">
          {problems.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      )}

      {plan.approvals.length > 0 && problems.length === 0 && (
        <p className="text-xs text-mist">
          {plan.approvals.length} approval{plan.approvals.length > 1 ? 's' : ''} needed first (exact amounts, never unlimited).
        </p>
      )}

      <button className="btn btn-primary w-full" disabled={running || problems.length > 0} onClick={go}>
        {running ? 'Working…' : verb}
      </button>
      <StepList steps={steps} />
      {forgedId !== null && <p className="text-sm text-lime">Done — crystal #{forgedId.toString()} is in your wallet. See it in My Crystals.</p>}
    </div>
  );
}
