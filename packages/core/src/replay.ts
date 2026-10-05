/**
 * A crystal's replay: its real history from its forge block to now, as keyframes for a short
 * time-lapse. At each moment: what was inside (from the contract's own Forged / Added /
 * Withdrawn events), each holding's weight by value and its 24h move (from the pools' price
 * history), the drops that cracked it and the moments they healed in gold, and for a gift the
 * frost and the unwrap. Pure: the app passes in the events, the prices and a block clock.
 */
import { formatUnits, type Address } from 'viem';
import type { CrystalEvent } from './activity';
import type { CrystalHistory, Holding } from './crystal';
import { LIVE_CRACK_THRESHOLD, MAX_CRYSTAL_DROPS, priceAt } from './history';
import type { PricePoint } from './pool';
import { valueWeights } from './onchain';

const ZERO = '0x0000000000000000000000000000000000000000';
const DAY = 86400;

/** What the replay needs to know about a token (null = ETH). */
export interface ReplayAssetInfo {
  symbol: string;
  decimals: number;
  /** ETH per token, step series (ETH itself: leave null and set `isEth`) */
  eth: PricePoint[] | null;
  isEth?: boolean;
  volatility: number;
}

/** A drop deep enough to crack the crystal: when it opened and when (if) it climbed back. */
export interface ReplayDrop {
  symbol: string;
  /** percent, peak to trough */
  depth: number;
  peakAt: number;
  /** first moment the price was `minDepth`% under its peak: the crack appears */
  openAt: number;
  /** first moment it was back at the peak: the crack fills with gold (null = still open) */
  healedAt: number | null;
}

export type ReplayEventKind = 'forged' | 'added' | 'withdrawn' | 'drop' | 'heal' | 'sealed' | 'gift' | 'unwrap';

export interface ReplayEvent {
  kind: ReplayEventKind;
  /** unix seconds */
  t: number;
  symbol?: string;
  depth?: number;
  /** gift: who received it · sealed: until when */
  to?: Address;
  until?: number;
}

export interface ReplayFrame {
  t: number;
  holdings: Holding[];
  history: CrystalHistory;
  /** total value in ETH (null when nothing inside could be priced) */
  valueEth: number | null;
}

export interface ReplayTimeline {
  id: bigint;
  start: number;
  end: number;
  frames: ReplayFrame[];
  events: ReplayEvent[];
  /** the value line: total ETH value through time */
  values: Array<{ t: number; eth: number | null }>;
  /** a gift (or a seal) in frost from `from` until `unwrapAt` (null = still frosted at the end) */
  frost: { from: number; unwrapAt: number | null } | null;
}

/**
 * Drops of at least `minDepth`% from a running peak, with the moment each one crossed the
 * line (the crack) and the moment the price was back at its peak (the gold).
 */
export function dropEvents(points: PricePoint[], symbol: string, minDepth = LIVE_CRACK_THRESHOLD): ReplayDrop[] {
  const pts = points.filter((p) => p.price > 0 && Number.isFinite(p.price)).sort((a, b) => a.t - b.t);
  const out: ReplayDrop[] = [];
  if (pts.length < 2) return out;
  let peak = pts[0]!;
  let trough = peak.price;
  let openAt: number | null = null;
  const close = (healedAt: number | null) => {
    if (openAt !== null) out.push({ symbol, depth: Math.round(((peak.price - trough) / peak.price) * 1000) / 10, peakAt: peak.t, openAt, healedAt });
  };
  for (const p of pts.slice(1)) {
    if (p.price >= peak.price) {
      close(p.t);
      peak = p;
      trough = p.price;
      openAt = null;
      continue;
    }
    if (p.price < trough) trough = p.price;
    if (openAt === null && p.price <= peak.price * (1 - minDepth / 100)) openAt = p.t;
  }
  close(null);
  return out;
}

/** The crystal's own events in chain order, with their times. */
function timed(events: CrystalEvent[], id: bigint, clock: (block: bigint) => number) {
  return events
    .filter((e) => e.id === id)
    .sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1))
    .map((e) => ({ e, t: clock(e.block) }));
}

/**
 * Build a crystal's replay from its forge to `now`. `info` describes each token it ever held;
 * `ethUsd` is ETH's USD price (24h moves are measured in USD, like everywhere in the app).
 */
export function buildReplay(input: {
  id: bigint;
  events: CrystalEvent[];
  clock: (block: bigint) => number;
  info: (token: Address | null) => ReplayAssetInfo;
  ethUsd: PricePoint[];
  /** earliest time the price history covers */
  historyStart: number;
  now: number;
  keyframes?: number;
  samples?: number;
}): ReplayTimeline {
  const { id, clock, info, ethUsd, now } = input;
  const evs = timed(input.events, id, clock);
  const forged = evs.find((x) => x.e.kind === 'forged');
  const start = Math.min(now, Math.max(forged?.t ?? input.historyStart, input.historyStart));
  const end = Math.max(now, start + 1);

  // every token it ever held, keyed by address (or "eth")
  const keyOf = (token: Address | null) => (token ? token.toLowerCase() : 'eth');
  const tokens = new Map<string, Address | null>();
  for (const { e } of evs) for (const m of e.moves ?? []) tokens.set(keyOf(m.token), m.token);
  const infos = new Map([...tokens].map(([k, t]) => [k, info(t)]));

  const ethPrice = (k: string, t: number): number | null => {
    const i = infos.get(k)!;
    if (i.isEth || k === 'eth') return 1;
    return i.eth ? priceAt(i.eth, t) : null;
  };
  const usdPrice = (k: string, t: number): number | null => {
    const e = ethPrice(k, t);
    const u = priceAt(ethUsd, t);
    return e === null || u === null ? null : e * u;
  };
  const amountsAt = (t: number) => {
    const out = new Map<string, bigint>();
    for (const { e, t: et } of evs) {
      if (et > t) break;
      for (const m of e.moves ?? []) out.set(keyOf(m.token), (out.get(keyOf(m.token)) ?? 0n) + m.amount);
    }
    return out;
  };
  const valueAt = (t: number) => {
    const amounts = amountsAt(t);
    const rows = [...amounts].filter(([, a]) => a > 0n).map(([k, a]) => {
      const p = ethPrice(k, t);
      return { k, a, value: p === null ? null : Number(formatUnits(a, infos.get(k)!.decimals)) * p };
    });
    const priced = rows.filter((r) => r.value !== null);
    return { rows, total: priced.length ? priced.reduce((s, r) => s + r.value!, 0) : null };
  };

  // drops over the whole window: the deepest few, in the order they opened (so the cracks
  // already on screen keep their place as new ones appear)
  const drops = [...tokens.keys()]
    .flatMap((k) => {
      const i = infos.get(k)!;
      const series = i.isEth || k === 'eth' ? ethUsd : i.eth ? i.eth.map((p) => ({ t: p.t, price: (priceAt(ethUsd, p.t) ?? NaN) * p.price })) : [];
      return dropEvents(series.filter((p) => p.t >= start - DAY && Number.isFinite(p.price)), i.symbol).filter((d) => d.openAt >= start);
    })
    .sort((a, b) => b.depth - a.depth)
    .slice(0, MAX_CRYSTAL_DROPS)
    .sort((a, b) => a.openAt - b.openAt);

  // gift / seal: frost from the seal (or the gift) until it opens
  const lastGift = [...evs].reverse().find((x) => x.e.kind === 'transfer' && x.e.from && x.e.to && x.e.from.toLowerCase() !== ZERO && x.e.to.toLowerCase() !== ZERO);
  const seals = evs.filter((x) => x.e.kind === 'sealed');
  const lastSeal = seals[seals.length - 1];
  const unlock = lastSeal?.e.unlockTime ?? 0;
  let frost: ReplayTimeline['frost'] = null;
  if (lastGift) {
    const sealedBefore = lastSeal && lastSeal.t <= lastGift.t && unlock > lastGift.t;
    const from = sealedBefore ? lastSeal!.t : lastGift.t;
    const opens = Math.max(lastGift.t, unlock);
    frost = { from, unwrapAt: opens <= end ? opens : null };
  } else if (lastSeal && unlock > lastSeal.t) {
    frost = { from: lastSeal.t, unwrapAt: unlock <= end ? unlock : null };
  }

  // events, in time order
  const events: ReplayEvent[] = [];
  for (const { e, t } of evs) {
    if (t < start - 1 && e.kind !== 'forged') continue;
    if (e.kind === 'forged') events.push({ kind: 'forged', t: Math.max(t, start) });
    else if (e.kind === 'added') events.push({ kind: 'added', t });
    else if (e.kind === 'withdrawn') events.push({ kind: 'withdrawn', t });
    else if (e.kind === 'sealed') events.push({ kind: 'sealed', t, until: e.unlockTime });
  }
  for (const d of drops) {
    events.push({ kind: 'drop', t: d.openAt, symbol: d.symbol, depth: d.depth });
    if (d.healedAt !== null && d.healedAt <= end) events.push({ kind: 'heal', t: d.healedAt, symbol: d.symbol, depth: d.depth });
  }
  if (lastGift && lastGift.t >= start) events.push({ kind: 'gift', t: lastGift.t, to: lastGift.e.to });
  if (frost?.unwrapAt != null) events.push({ kind: 'unwrap', t: frost.unwrapAt });
  // same moment: keep a natural order (forge → seal → gift → drop → heal → unwrap)
  const ORDER: ReplayEventKind[] = ['forged', 'added', 'withdrawn', 'sealed', 'gift', 'drop', 'heal', 'unwrap'];
  events.sort((a, b) => a.t - b.t || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

  const frameAt = (t: number): ReplayFrame => {
    const { rows, total } = valueAt(t);
    const weights = valueWeights(rows.map((r) => r.value));
    const holdings: Holding[] = rows.map((r, i) => {
      const now24 = usdPrice(r.k, t);
      const then24 = usdPrice(r.k, t - DAY);
      const change = now24 !== null && then24 !== null && then24 > 0 ? (now24 / then24 - 1) * 100 : Number.NaN;
      const i2 = infos.get(r.k)!;
      return { symbol: i2.symbol, weight: weights[i]!, change24h: change, volatility: i2.volatility };
    });
    const history: CrystalHistory = {
      drawdowns: drops
        .filter((d) => d.openAt <= t)
        .map((d) => ({ symbol: d.symbol, depth: d.depth, recovered: d.healedAt !== null && d.healedAt <= t })),
    };
    return { t, holdings, history, valueEth: total };
  };

  const K = Math.max(2, input.keyframes ?? 32);
  const S = Math.max(2, input.samples ?? 120);
  const at = (i: number, n: number) => start + ((end - start) * i) / (n - 1);
  return {
    id,
    start,
    end,
    frames: Array.from({ length: K }, (_, i) => frameAt(at(i, K))),
    events,
    values: Array.from({ length: S }, (_, i) => {
      const t = at(i, S);
      return { t, eth: valueAt(t).total };
    }),
    frost,
  };
}

// ---------------------------------------------------------------------------
// Playback: seconds of video ↔ moments of the crystal's life
// ---------------------------------------------------------------------------

export interface ReplayPlan {
  /** the crystal assembles (its forge) */
  intro: number;
  /** the time-lapse itself */
  lapse: number;
  /** the end card */
  outro: number;
  total: number;
}

/** 8–15 s in all: a little longer when more happened. */
export function replayPlan(timeline: ReplayTimeline): ReplayPlan {
  const intro = 1.2;
  const outro = 2.6;
  const lapse = Math.min(10.5, Math.max(6.5, 6.5 + 0.6 * timeline.events.filter((e) => e.kind !== 'forged').length));
  return { intro, lapse, outro, total: intro + lapse + outro };
}

/** The crystal's moment (unix s) shown at `seconds` into the video, and where we are. */
export function replayTimeAt(timeline: ReplayTimeline, plan: ReplayPlan, seconds: number): { t: number; phase: 'intro' | 'lapse' | 'outro'; progress: number } {
  if (seconds < plan.intro) return { t: timeline.start, phase: 'intro', progress: Math.max(0, seconds / plan.intro) };
  if (seconds < plan.intro + plan.lapse) {
    const p = (seconds - plan.intro) / plan.lapse;
    return { t: timeline.start + (timeline.end - timeline.start) * p, phase: 'lapse', progress: p };
  }
  return { t: timeline.end, phase: 'outro', progress: Math.min(1, (seconds - plan.intro - plan.lapse) / plan.outro) };
}

/** When (seconds into the video) a moment of the crystal's life is shown. */
export function replaySecondsAt(timeline: ReplayTimeline, plan: ReplayPlan, t: number): number {
  const span = Math.max(1, timeline.end - timeline.start);
  return plan.intro + Math.min(1, Math.max(0, (t - timeline.start) / span)) * plan.lapse;
}
