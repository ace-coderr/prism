import { describe, expect, it } from 'vitest';
import type { PublicClient } from 'viem';
import { V6_CURVE_TOKENS, decodePackedWeights, readLaunchSetup, setupLines, type LaunchSetup } from '../src';

// real packedWeights from chain: VIBEVIBE's launch event, VINI's token, VIBECHECK (NVDA-paired)
const VIBEVIBE = 0x0fa00fa007d0n;
const VINI = 2147975170000n;
const VIBECHECK = 0x2710000000000000n;

describe('v6 tax split (packedWeights)', () => {
  it('decodes treasury, holders-in-token, burn, holders-in-pair as vibe/vibe does', () => {
    expect(decodePackedWeights(VIBEVIBE)).toEqual({ treasury: 2000, holdersToken: 4000, burn: 4000, holdersPair: 0 });
    expect(decodePackedWeights(VINI)).toEqual({ treasury: 2000, holdersToken: 7500, burn: 500, holdersPair: 0 });
    expect(decodePackedWeights(VIBECHECK)).toEqual({ treasury: 0, holdersToken: 0, burn: 0, holdersPair: 10000 });
    for (const p of [VIBEVIBE, VINI, VIBECHECK]) {
      const w = decodePackedWeights(p);
      expect(w.treasury + w.holdersToken + w.burn + w.holdersPair).toBe(10000);
    }
  });

  it('says it in plain words, one line each, as shares of every trade', () => {
    const setup: LaunchSetup = { kind: 'v6', taxBps: 200, split: decodePackedWeights(VIBEVIBE), protocolShareBps: 2000, airdrop: null, projectTreasury: null, createdAt: null, progress: 0.5, graduated: false };
    const lines = setupLines(setup, '$VIBEVIBE', 'ETH');
    expect(lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      'Project tax: 2% of every trade.',
      'Treasury: 20% of the creator’s part → the project treasury, paid in ETH (0.32% of every trade)',
      'Holder rewards in ETH: None',
      'Holder rewards in $VIBEVIBE: 40% of the creator’s part → holders, paid in $VIBEVIBE (0.64% of every trade)',
      'Burn: 40% of the creator’s part → burned $VIBEVIBE (0.64% of every trade)',
      'Protocol share: Fixed 20% of the tax (0.4% of every trade).',
      'Graduation airdrop: None configured.',
    ]);
    const withAirdrop = setupLines({ ...setup, airdrop: { wallets: 1200, tokens: 10n ** 24n } }, '$X', 'NVDA');
    expect(withAirdrop.at(-1)!.value).toBe('1,200 wallets get $X when it graduates.');
  });

  it('older generations: the fixed curve fee, and “not available” for what they don’t have', () => {
    const lines = setupLines({ kind: 'curve-fee', feeBps: 125, creatorShareBps: 7500, creatorVault: null, createdAt: null, progress: 0, graduated: false }, '$PEPE', 'ETH');
    expect(lines.map((l) => [l.label, l.value, l.available])).toEqual([
      ['Project tax', 'Not available for this launch generation: its curve charges a fixed 1.25% fee instead.', false],
      ['Creator’s part', '75% of the fee (0.94% of every trade) to the creator’s vault.', true],
      ['Holder rewards & burn', 'Not available for this launch generation', false],
      ['Protocol share', 'Fixed 25% of the fee (0.31% of every trade).', true],
      ['Graduation airdrop', 'Not available for this launch generation', false],
    ]);
    expect(setupLines({ kind: 'stock' }, '$AAPL', 'ETH')[0]!.value).toMatch(/test stock/);
  });
});

describe('reading a setup (fake chain)', () => {
  const fake = (results: unknown[]) =>
    ({ multicall: async () => results.map((r) => (r instanceof Error ? { status: 'failure', error: r } : { status: 'success', result: r })) }) as unknown as PublicClient;
  const launch = { curve: '0x0000000000000000000000000000000000000001', token: '0x0000000000000000000000000000000000000002' } as const;

  it('v6: tax, split, airdrop and bonding progress from the curve and token', async () => {
    const s = await readLaunchSetup(fake([200n, V6_CURVE_TOKENS / 4n, false, 1791723856n, launch.curve, VINI, 12n, 5n * 10n ** 24n, 10n ** 18n, 4n * 10n ** 18n]), { ...launch, gen: 6 });
    expect(s).toMatchObject({ kind: 'v6', taxBps: 200, progress: 0.25, graduated: false, createdAt: 1791723856, airdrop: { wallets: 12, tokens: 5n * 10n ** 24n } });
    const done = await readLaunchSetup(fake([300n, 0n, true, 1n, launch.curve, VIBEVIBE, 0n, 0n, 0n, 4n * 10n ** 18n]), { ...launch, gen: 6 });
    expect(done).toMatchObject({ progress: 1, graduated: true, airdrop: null });
  });

  it('older curves: fee, creator share and progress; unreadable values become null, not wrong numbers', async () => {
    const inv = 793_100_000n * 10n ** 18n;
    const s = await readLaunchSetup(fake([125n, 7500n, inv, inv - inv / 10n, false, 1791648777n, launch.curve, 5n * 10n ** 17n, 5n * 10n ** 18n]), { ...launch, gen: 2 });
    expect(s).toMatchObject({ kind: 'curve-fee', feeBps: 125, creatorShareBps: 7500, progress: 0.1, graduated: false });
    const broken = await readLaunchSetup(fake(Array.from({ length: 9 }, () => new Error('x'))), { ...launch, gen: 0 });
    expect(broken).toMatchObject({ kind: 'curve-fee', feeBps: null, creatorShareBps: null, progress: null, graduated: null });
    expect(setupLines(broken, '$A', 'ETH')[1]!.value).toBe('Couldn’t be read.');
  });
});
